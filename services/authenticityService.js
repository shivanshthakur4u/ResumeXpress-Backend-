// Scores how generic a resume reads.
//
// Deliberately deterministic rather than an AI call: the point of this feature
// is to tell a user exactly which words are the problem, which means the result
// has to be explainable and reproducible. It also costs nothing and keeps
// working when the AI provider is rate-limited.
//
// Findings never rewrite the user's text. Following the product rule that AI
// may improve how a candidate's history reads but must never invent it, each
// finding asks a question only the candidate can answer.

const LEXICON = [
  {
    category: "cliche",
    weight: 12,
    why: "A stock resume phrase that appears on millions of other resumes.",
    ask: "What did you actually do that would make a reader believe this?",
    phrases: [
      "results-driven", "results driven", "detail-oriented", "detail oriented",
      "team player", "hard worker", "hard-working", "self-starter", "go-getter",
      "think outside the box", "outside the box", "proven track record",
      "track record of success", "dynamic professional", "seasoned professional",
      "passionate about", "highly motivated", "strong work ethic",
      "excellent communication skills", "works well under pressure",
      "wide range of", "fast-paced environment",
    ],
  },
  {
    category: "ai-tell",
    weight: 14,
    why: "Heavily overused by AI writing tools. Recruiters increasingly read it as machine-generated.",
    ask: "How would you describe this out loud to a colleague?",
    phrases: [
      "leveraged", "leveraging", "spearheaded", "orchestrated", "synergy",
      "synergies", "cross-functional synergies", "utilized", "utilizing",
      "facilitated", "streamlined", "optimized workflows", "drove impact",
      "delivered value", "best practices", "cutting-edge", "state-of-the-art",
      "robust solutions", "seamless integration", "holistic approach",
      "actionable insights", "empowered", "transformative",
      "innovative solutions", "elevate", "unlock the potential",
      "in today's fast-paced world", "meticulous", "spearheading",
    ],
  },
  {
    category: "duty-not-impact",
    weight: 10,
    why: "Describes a duty you were assigned rather than a contribution you made.",
    ask: "What changed because you did this? What was different afterwards?",
    phrases: [
      "responsible for", "duties included", "tasked with", "worked on",
      "helped with", "assisted with", "involved in", "participated in",
      "in charge of", "handled",
    ],
  },
  {
    category: "vague-scale",
    weight: 6,
    why: "A vague quantifier that hides the real scope of the work.",
    ask: "How many, exactly? A real number is more convincing than 'several'.",
    phrases: [
      "various", "several", "numerous", "multiple stakeholders", "many different",
      "a number of", "some of the",
    ],
  },
];

// Statements with no anchor at all are the ones that read as filler.
const MISSING_ANCHOR_PENALTY = 25;

// A statement that is BOTH unanchored and built from stock phrases is filler by
// definition. Scoring the two independently let "Responsible for various tasks"
// land mid-range, which reads as a passable bullet when it is the worst kind.
const FILLER_COMBINATION_PENALTY = 20;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Built once. Word boundaries stop "utilized" matching inside a longer word.
const MATCHERS = LEXICON.flatMap((group) =>
  group.phrases.map((phrase) => ({
    ...group,
    phrase,
    regex: new RegExp(`\\b${escapeRegex(phrase)}\\b`, "gi"),
  }))
);

export const stripHtml = (value = "") =>
  String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// Rich text arrives as list items; plain text is split on sentence ends.
export const splitStatements = (text = "") =>
  stripHtml(text)
    .split(/(?<=[.!?])\s+|\n+|(?:^|\s)[•\-–]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

// A concrete anchor is a number, or a capitalised word used mid-sentence, which
// is a rough proxy for a named tool, product or company. It is a heuristic: it
// will miss a lowercase tool name and can be fooled by a capitalised first word
// of a clause.
export const hasConcreteAnchor = (text) => {
  if (/\d/.test(text)) return true;
  return text
    .split(/\s+/)
    .slice(1)
    .some((word) => /^[A-Z][A-Za-z0-9.+#]{1,}$/.test(word.replace(/[^\w.+#]/g, "")));
};

export const scoreStatement = (raw) => {
  const text = stripHtml(raw);
  const findings = [];
  let penalty = 0;

  for (const matcher of MATCHERS) {
    matcher.regex.lastIndex = 0;
    const found = text.match(matcher.regex);
    if (!found) continue;
    penalty += matcher.weight * found.length;
    findings.push({
      category: matcher.category,
      phrase: found[0],
      occurrences: found.length,
      why: matcher.why,
      ask: matcher.ask,
    });
  }

  const lexiconHits = findings.length;
  const anchored = hasConcreteAnchor(text);
  if (!anchored) {
    penalty += MISSING_ANCHOR_PENALTY;
    if (lexiconHits > 0) penalty += FILLER_COMBINATION_PENALTY;
    findings.push({
      category: "no-specifics",
      phrase: null,
      occurrences: 1,
      why: "No number, tool or named thing — nothing here is specific to you.",
      ask: "What number, tool or name could you add that only applies to your version of this work?",
    });
  }

  return {
    text,
    score: Math.max(0, Math.min(100, 100 - penalty)),
    anchored,
    findings,
  };
};

export const bandFor = (score) =>
  score >= 75 ? "specific" : score >= 50 ? "mixed" : "generic";

const analyseField = (label, raw) => {
  const statements = splitStatements(raw).map(scoreStatement);
  if (!statements.length) return null;

  const score = Math.round(
    statements.reduce((total, s) => total + s.score, 0) / statements.length
  );

  return {
    label,
    score,
    band: bandFor(score),
    // Worst first: that is the order a user should fix them in.
    statements: statements.sort((a, b) => a.score - b.score),
  };
};

export const analyzeResume = (resume) => {
  const fields = [
    analyseField("Professional summary", resume.summary),
    ...(resume.experience ?? []).map((exp, i) =>
      analyseField(
        exp.title ? `Experience — ${exp.title}` : `Experience ${i + 1}`,
        exp.workSummary
      )
    ),
    ...(resume.education ?? []).map((edu, i) =>
      analyseField(
        edu.degree ? `Education — ${edu.degree}` : `Education ${i + 1}`,
        edu.description
      )
    ),
    ...(resume.sections ?? [])
      .filter((section) => !section.hidden)
      .map((section) => analyseField(section.title || "Section", section.content)),
  ].filter(Boolean);

  if (!fields.length) {
    return {
      score: null,
      band: null,
      fields: [],
      topFixes: [],
      message: "Add some content to this resume before checking how it reads.",
    };
  }

  const score = Math.round(
    fields.reduce((total, f) => total + f.score, 0) / fields.length
  );

  // The handful of statements actually worth rewriting first.
  const topFixes = fields
    .flatMap((field) =>
      field.statements
        .filter((s) => s.score < 75)
        .map((s) => ({ field: field.label, ...s }))
    )
    .sort((a, b) => a.score - b.score)
    .slice(0, 5);

  return { score, band: bandFor(score), fields, topFixes };
};
