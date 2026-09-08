import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeResume,
  bandFor,
  hasConcreteAnchor,
  scoreStatement,
  splitStatements,
  stripHtml,
} from "../services/authenticityService.js";

const categoriesIn = (result) => result.findings.map((f) => f.category);

describe("stripHtml", () => {
  test("removes the rich text editor's markup", () => {
    assert.equal(
      stripHtml("<ul><li>Built&nbsp;the <b>thing</b></li></ul>"),
      "Built the thing"
    );
  });

  test("tolerates empty and missing input", () => {
    assert.equal(stripHtml(""), "");
    assert.equal(stripHtml(undefined), "");
  });
});

describe("splitStatements", () => {
  test("splits list items into separate statements", () => {
    const statements = splitStatements(
      "<ul><li>Shipped the API.</li><li>Cut latency by 40%.</li></ul>"
    );
    assert.equal(statements.length, 2);
    assert.match(statements[1], /Cut latency/);
  });

  test("splits prose on sentence boundaries", () => {
    assert.equal(splitStatements("One thing. Two thing. Three.").length, 3);
  });
});

describe("hasConcreteAnchor", () => {
  test("a number counts", () => {
    assert.equal(hasConcreteAnchor("Shipped 3 features"), true);
  });

  test("a named tool mid-sentence counts", () => {
    assert.equal(hasConcreteAnchor("Deployed on Kubernetes"), true);
  });

  test("generic prose with neither does not", () => {
    assert.equal(hasConcreteAnchor("Built the thing quickly"), false);
  });

  test("a capitalised first word alone is not an anchor", () => {
    assert.equal(hasConcreteAnchor("Managed the team"), false);
  });
});

describe("scoreStatement", () => {
  test("scores AI-flavoured filler near zero and names the phrases", () => {
    const result = scoreStatement(
      "Results-driven professional responsible for leveraging cross-functional synergies."
    );

    assert.ok(result.score <= 20, `expected a low score, got ${result.score}`);
    assert.ok(categoriesIn(result).includes("cliche"));
    assert.ok(categoriesIn(result).includes("ai-tell"));
    assert.ok(categoriesIn(result).includes("duty-not-impact"));
    assert.ok(categoriesIn(result).includes("no-specifics"));
  });

  test("scores a specific, human statement full marks", () => {
    const result = scoreStatement(
      "Cut p95 checkout latency from 1.8s to 340ms by putting a Redis cache in front of the pricing service."
    );

    assert.equal(result.score, 100);
    assert.equal(result.anchored, true);
    assert.deepEqual(result.findings, []);
  });

  test("flags a duty phrasing even when the statement has numbers", () => {
    const result = scoreStatement("Responsible for 4 microservices in production.");
    assert.ok(categoriesIn(result).includes("duty-not-impact"));
    // It has a number, so it is not also penalised for having no specifics.
    assert.equal(categoriesIn(result).includes("no-specifics"), false);
  });

  test("penalises a statement with no number or named thing", () => {
    const bare = scoreStatement("Improved the process for the team.");
    assert.ok(categoriesIn(bare).includes("no-specifics"));
    assert.equal(bare.anchored, false);
  });

  test("respects word boundaries", () => {
    // "reutilized" must not trip the "utilized" matcher.
    const result = scoreStatement("Reutilized 5 components from Storybook.");
    assert.equal(categoriesIn(result).includes("ai-tell"), false);
  });

  test("counts repeated offenders once per occurrence", () => {
    const result = scoreStatement("Leveraged this and leveraged that.");
    const aiTell = result.findings.find((f) => f.category === "ai-tell");
    assert.equal(aiTell.occurrences, 2);
  });

  test("never rewrites the candidate's text — it only asks", () => {
    const result = scoreStatement("Responsible for various tasks.");
    for (const finding of result.findings) {
      assert.equal(typeof finding.ask, "string");
      assert.ok(finding.ask.length > 0);
      // A suggested replacement would mean inventing the candidate's history.
      assert.equal(finding.suggestion, undefined);
      assert.equal(finding.rewrite, undefined);
    }
  });
});

describe("bandFor", () => {
  test("maps scores to bands", () => {
    assert.equal(bandFor(90), "specific");
    assert.equal(bandFor(75), "specific");
    assert.equal(bandFor(60), "mixed");
    assert.equal(bandFor(20), "generic");
  });
});

describe("analyzeResume", () => {
  const sludgyResume = {
    summary: "Results-driven professional passionate about delivering value.",
    experience: [
      {
        title: "Engineer",
        workSummary:
          "<ul><li>Responsible for various tasks.</li><li>Leveraged synergies across teams.</li></ul>",
      },
    ],
    education: [],
  };

  test("returns an overall score, band and per-field breakdown", () => {
    const result = analyzeResume(sludgyResume);

    assert.equal(typeof result.score, "number");
    assert.equal(result.band, "generic");
    assert.equal(result.fields.length, 2);
    assert.equal(result.fields[0].label, "Professional summary");
    assert.equal(result.fields[1].label, "Experience — Engineer");
  });

  test("orders the worst statements first so they are fixed first", () => {
    const result = analyzeResume({
      summary:
        "Shipped the Stripe billing migration for 40,000 accounts with no downtime.",
      experience: [
        { title: "Engineer", workSummary: "Responsible for various tasks." },
      ],
    });

    assert.ok(result.topFixes.length >= 1);
    assert.match(result.topFixes[0].text, /Responsible for various tasks/);
    // The strong statement is not offered as something to fix.
    assert.equal(
      result.topFixes.some((f) => /Stripe billing/.test(f.text)),
      false
    );
  });

  test("caps the fix list so the user is not handed a wall of work", () => {
    const result = analyzeResume({
      summary: "",
      experience: Array.from({ length: 12 }, (_, i) => ({
        title: `Role ${i}`,
        workSummary: "Responsible for various tasks.",
      })),
    });
    assert.ok(result.topFixes.length <= 5);
  });

  test("a strong resume scores in the specific band", () => {
    const result = analyzeResume({
      summary:
        "Backend engineer who moved Acme's checkout from 1.8s to 340ms on 12M monthly requests.",
      experience: [
        {
          title: "Engineer",
          workSummary:
            "<ul><li>Rebuilt the pricing service in Go, cutting spend by 30%.</li></ul>",
        },
      ],
    });
    assert.equal(result.band, "specific");
  });

  test("an empty resume asks for content instead of scoring zero", () => {
    const result = analyzeResume({ summary: "", experience: [], education: [] });
    assert.equal(result.score, null);
    assert.deepEqual(result.fields, []);
    assert.match(result.message, /Add some content/);
  });

  test("skips hidden sections", () => {
    const result = analyzeResume({
      summary: "Responsible for various tasks.",
      sections: [
        { title: "Hidden", content: "Leveraged synergies.", hidden: true },
        { title: "Projects", content: "Built Foo with 3 collaborators.", hidden: false },
      ],
    });
    assert.equal(
      result.fields.some((f) => f.label === "Hidden"),
      false
    );
    assert.equal(
      result.fields.some((f) => f.label === "Projects"),
      true
    );
  });
});
