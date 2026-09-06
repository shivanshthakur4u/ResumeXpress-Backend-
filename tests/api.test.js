import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import supertest from "supertest";

let mongo;
let request;
let mongoose;

// Set before importing the app: config/env.js validates on import, and dotenv
// does not overwrite variables that are already present.
before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.NODE_ENV = "test";
  process.env.DB_URI = mongo.getUri();
  process.env.JWT_SECRET = "test-secret-that-is-long-enough-to-pass-validation";
  process.env.FRONTEND_URL = "http://localhost:3000";

  const [{ default: app }, mongooseMod] = await Promise.all([
    import("../index.js"),
    import("mongoose"),
  ]);
  mongoose = mongooseMod.default;
  request = supertest(app);
});

after(async () => {
  await mongoose?.disconnect();
  await mongo?.stop();
});

const registerUser = async ({ name, email, password = "Password123" }) => {
  const res = await request
    .post("/api/v1/user/register")
    .send({ name, email, password });
  return res;
};

const authFor = async (email) => {
  const res = await registerUser({ name: "Test User", email });
  assert.equal(res.status, 201, `register failed: ${JSON.stringify(res.body)}`);
  return res.body.data.token;
};

const createResume = async (token, title) => {
  const res = await request
    .post("/api/v1/resume/createResume")
    .set("Authorization", `Bearer ${token}`)
    .send({ title });
  assert.equal(res.status, 201, `create failed: ${JSON.stringify(res.body)}`);
  return res.body._id;
};

describe("health", () => {
  test("responds without touching the database", async () => {
    const res = await request.get("/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
  });
});

describe("registration validation", () => {
  test("rejects a weak password", async () => {
    const res = await registerUser({
      name: "Weak",
      email: "weak@example.com",
      password: "abc",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.errors?.some((e) => e.field === "body.password"));
  });

  test("rejects a malformed email", async () => {
    const res = await registerUser({
      name: "Bad Email",
      email: "not-an-email",
      password: "Password123",
    });
    assert.equal(res.status, 400);
  });

  test("never returns the password hash", async () => {
    const res = await registerUser({
      name: "Clean",
      email: "clean@example.com",
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.password, undefined);
    assert.ok(res.body.data.token);
  });

  test("rejects a duplicate email", async () => {
    await registerUser({ name: "First", email: "dupe@example.com" });
    const res = await registerUser({ name: "Second", email: "dupe@example.com" });
    assert.equal(res.status, 409);
  });
});

describe("sign-in does not leak which accounts exist", () => {
  test("unknown email and wrong password return the same response", async () => {
    await registerUser({ name: "Known", email: "known@example.com" });

    const wrongPassword = await request
      .post("/api/v1/user/signin")
      .send({ email: "known@example.com", password: "WrongPassword123" });

    const unknownEmail = await request
      .post("/api/v1/user/signin")
      .send({ email: "nobody@example.com", password: "WrongPassword123" });

    assert.equal(wrongPassword.status, 400);
    assert.equal(unknownEmail.status, 400);
    assert.equal(wrongPassword.body.message, unknownEmail.body.message);
  });
});

describe("forgot password does not leak which accounts exist", () => {
  test("unknown address still reports success", async () => {
    const res = await request
      .post("/api/v1/user/forgot-password")
      .send({ email: "ghost@example.com" });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });
});

describe("resume access control", () => {
  test("rejects unauthenticated access", async () => {
    const res = await request.get("/api/v1/resume/getResumes");
    assert.equal(res.status, 401);
  });

  test("rejects a malformed token", async () => {
    const res = await request
      .get("/api/v1/resume/getResumes")
      .set("Authorization", "Bearer not-a-real-token");
    assert.equal(res.status, 401);
  });

  test("a user cannot read another user's resume", async () => {
    const alice = await authFor("alice@example.com");
    const bob = await authFor("bob@example.com");
    const aliceResume = await createResume(alice, "Alice CV");

    const res = await request
      .get(`/api/v1/resume/getResumeById/${aliceResume}`)
      .set("Authorization", `Bearer ${bob}`);

    assert.equal(res.status, 404);
  });

  test("a user cannot update another user's resume", async () => {
    const alice = await authFor("alice2@example.com");
    const bob = await authFor("bob2@example.com");
    const aliceResume = await createResume(alice, "Alice CV 2");

    const res = await request
      .put(`/api/v1/resume/updateResume/${aliceResume}`)
      .set("Authorization", `Bearer ${bob}`)
      .send({ summary: "owned by bob now" });

    assert.equal(res.status, 404);
  });

  test("a user cannot delete another user's resume", async () => {
    const alice = await authFor("alice3@example.com");
    const bob = await authFor("bob3@example.com");
    const aliceResume = await createResume(alice, "Alice CV 3");

    const res = await request
      .delete(`/api/v1/resume/deleteResumeById/${aliceResume}`)
      .set("Authorization", `Bearer ${bob}`);

    assert.equal(res.status, 404);

    // And it is genuinely still there for its owner.
    const stillThere = await request
      .get(`/api/v1/resume/getResumeById/${aliceResume}`)
      .set("Authorization", `Bearer ${alice}`);
    assert.equal(stillThere.status, 200);
  });
});

describe("mass assignment", () => {
  test("userEmail in the request body cannot reassign ownership", async () => {
    const alice = await authFor("alice4@example.com");
    const bob = await authFor("bob4@example.com");
    const bobResume = await createResume(bob, "Bob CV");

    const res = await request
      .put(`/api/v1/resume/updateResume/${bobResume}`)
      .set("Authorization", `Bearer ${bob}`)
      .send({ summary: "legit update", userEmail: "alice4@example.com" });

    assert.equal(res.status, 200);

    // Alice must not have gained access to Bob's resume.
    const aliceAttempt = await request
      .get(`/api/v1/resume/getResumeById/${bobResume}`)
      .set("Authorization", `Bearer ${alice}`);
    assert.equal(aliceAttempt.status, 404);

    // And Bob must not have lost it.
    const bobAccess = await request
      .get(`/api/v1/resume/getResumeById/${bobResume}`)
      .set("Authorization", `Bearer ${bob}`);
    assert.equal(bobAccess.status, 200);
    assert.equal(bobAccess.body.resume.summary, "legit update");
  });

  test("unknown fields are stripped rather than persisted", async () => {
    const token = await authFor("stripper@example.com");
    const id = await createResume(token, "Strip CV");

    const res = await request
      .put(`/api/v1/resume/updateResume/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ summary: "ok", isPublic: true, __v: 99 });

    assert.equal(res.status, 200);
    // isPublic is not a client-writable field on this route; it has its own
    // endpoint, so the resume must still be private.
    const anon = await request.get(`/api/v1/resume/getResumeById/${id}`);
    assert.equal(anon.status, 404);
  });
});

describe("public sharing is opt-in", () => {
  test("a resume is private until its owner publishes it", async () => {
    const token = await authFor("sharer@example.com");
    const id = await createResume(token, "Shared CV");

    const beforePublish = await request.get(
      `/api/v1/resume/getResumeById/${id}`
    );
    assert.equal(beforePublish.status, 404);

    const publish = await request
      .patch(`/api/v1/resume/visibility/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ isPublic: true });
    assert.equal(publish.status, 200);
    assert.equal(publish.body.isPublic, true);

    const afterPublish = await request.get(
      `/api/v1/resume/getResumeById/${id}`
    );
    assert.equal(afterPublish.status, 200);

    // Even when public, internal ownership fields are not exposed.
    assert.equal(afterPublish.body.resume.userEmail, undefined);
    assert.equal(afterPublish.body.resume.user, undefined);
  });

  test("only the owner can change visibility", async () => {
    const owner = await authFor("owner@example.com");
    const stranger = await authFor("stranger@example.com");
    const id = await createResume(owner, "Owner CV");

    const res = await request
      .patch(`/api/v1/resume/visibility/${id}`)
      .set("Authorization", `Bearer ${stranger}`)
      .send({ isPublic: true });

    assert.equal(res.status, 404);
  });
});

describe("resume listing", () => {
  test("returns only the caller's resumes", async () => {
    const alice = await authFor("list-alice@example.com");
    const bob = await authFor("list-bob@example.com");
    await createResume(alice, "A1");
    await createResume(alice, "A2");
    await createResume(bob, "B1");

    const res = await request
      .get("/api/v1/resume/getResumes?page=1&limit=10")
      .set("Authorization", `Bearer ${alice}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.resumes.length, 2);
    assert.deepEqual(
      res.body.resumes.map((r) => r.title).sort(),
      ["A1", "A2"]
    );
  });

  test("rejects a duplicate title for the same user", async () => {
    const token = await authFor("dupe-title@example.com");
    await createResume(token, "Same Title");

    const res = await request
      .post("/api/v1/resume/createResume")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Same Title" });

    assert.equal(res.status, 409);
  });
});

describe("error handling", () => {
  test("unknown routes return the standard error shape", async () => {
    const res = await request.get("/api/v1/does-not-exist");
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.ok(typeof res.body.message === "string");
  });

  test("a malformed object id is a 400, not a 500", async () => {
    const res = await request.get("/api/v1/resume/getResumeById/not-an-id");
    assert.equal(res.status, 400);
  });
});
