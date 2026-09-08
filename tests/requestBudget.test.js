import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
// Imported statically: a describe() body runs at collection time, before
// before() has had a chance to assign anything.
import { z } from "zod";

let requestContext;
let remainingBudget;
let generateStructured;

before(async () => {
  process.env.DB_URI = "mongodb://127.0.0.1:27017/unused";
  process.env.JWT_SECRET = "test-secret-that-is-long-enough-to-pass-validation";

  ({ requestContext, remainingBudget } = await import(
    "../utils/requestContext.js"
  ));
  ({ generateStructured } = await import("../services/ai/geminiProvider.js"));
});

describe("remainingBudget", () => {
  test("returns the cap when there is no request context", () => {
    assert.equal(remainingBudget(5000), 5000);
  });

  test("is capped by the time left in the request", () =>
    requestContext.run({ deadline: Date.now() + 1000 }, () => {
      const budget = remainingBudget(8000);
      assert.ok(budget <= 1000, `expected <= 1000, got ${budget}`);
      assert.ok(budget > 800, `expected close to 1000, got ${budget}`);
    }));

  test("never returns a negative budget once the deadline has passed", () =>
    requestContext.run({ deadline: Date.now() - 5000 }, () => {
      assert.equal(remainingBudget(8000), 0);
    }));

  test("does not inflate the budget beyond the cap", () =>
    requestContext.run({ deadline: Date.now() + 60_000 }, () => {
      assert.equal(remainingBudget(3000), 3000);
    }));
});

describe("AI calls respect the request deadline", () => {
  const schema = z.object({ a: z.string() });

  test("fails immediately when the request has no time left", async () => {
    await requestContext.run({ deadline: Date.now() - 1 }, async () => {
      const started = Date.now();
      await assert.rejects(
        () => generateStructured({ prompt: "hello", schema }),
        (err) => {
          assert.equal(err.statusCode, 503);
          assert.match(err.message, /ran out of time/i);
          return true;
        }
      );
      // The point of the deadline: it must not sit and wait out a fixed budget.
      assert.ok(
        Date.now() - started < 500,
        `expected an immediate failure, took ${Date.now() - started}ms`
      );
    });
  });

  test("fails fast rather than burning a fixed budget on a near-expired request", async () => {
    await requestContext.run({ deadline: Date.now() + 400 }, async () => {
      const started = Date.now();
      await assert.rejects(() => generateStructured({ prompt: "hello", schema }));
      // A fixed 8s budget would have run far past the request's own deadline.
      assert.ok(
        Date.now() - started < 1500,
        `expected a fast failure, took ${Date.now() - started}ms`
      );
    });
  });
});
