import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import { generateText, generateStructured } from "./ai/geminiProvider.js";

// The product rule: AI may improve how a candidate's history reads, but it may
// never invent the history itself. Applied to every prompt in this service.
const TRUTHFULNESS_RULE = `
You help candidates express their real experience more clearly.
You must NEVER invent: employers, job titles, degrees, certifications,
technologies, achievements, metrics, revenue figures, user counts,
percentages, dates, or responsibilities.
Write in a way that is strong but generic enough to remain truthful when the
candidate has not supplied specifics. Never insert placeholder numbers such as
"increased sales by 30%" unless the candidate provided that figure.
`.trim();

const summaryItem = z.object({
  summary: z.string().min(1).max(2000),
  experience_level: z.string().min(1).max(50),
});

// Gemini's JSON mode sometimes wraps the array in an object, so both shapes are
// accepted and normalised to a plain array.
const summariesSchema = z.union([
  z.array(summaryItem),
  z
    .object({ summaries: z.array(summaryItem) })
    .transform((o) => o.summaries),
  z
    .record(z.array(summaryItem))
    .transform((o) => Object.values(o)[0] ?? []),
]);

export const generateSummaries = async ({ jobTitle }) => {
  const summaries = await generateStructured({
    systemInstruction: TRUTHFULNESS_RULE,
    schema: summariesSchema,
    prompt: `Job title: "${jobTitle}".

Write 3 professional resume summaries for this job title, one for each
experience level: Fresher, Mid Level, and Senior. Each summary is 3-4 lines.

Do not include specific metrics, employer names, or years of experience that
were not given to you.

Return a JSON array. Each element must have exactly these fields:
  "summary": the summary text
  "experience_level": one of "Fresher", "Mid Level", "Senior"`,
  });

  return summaries.slice(0, 5);
};

// The result is injected into a rich-text editor and later rendered as HTML in
// the resume preview, so model output is stripped to a safe tag allowlist.
const sanitizeBullets = (html) =>
  sanitizeHtml(html, {
    allowedTags: ["ul", "ol", "li", "p", "br", "b", "i", "strong", "em", "u"],
    allowedAttributes: {},
    disallowedTagsMode: "discard",
  });

const toBulletHtml = (text) => {
  if (/<\s*(ul|ol|li|p)\b/i.test(text)) return text;
  const items = text
    .split("\n")
    .map((l) => l.replace(/^[\s*\-•]+/, "").trim())
    .filter(Boolean)
    .map((l) => `<li>${l}</li>`)
    .join("");
  return `<ul>${items}</ul>`;
};

export const generateExperienceBullets = async ({ positionTitle }) => {
  const raw = await generateText({
    systemInstruction: TRUTHFULNESS_RULE,
    prompt: `Position title: "${positionTitle}".

Write 5-7 resume bullet points describing typical responsibilities and
contributions for this position. Focus on scope and capability rather than
invented numbers.

Return HTML only: a single <ul> containing <li> elements. No commentary,
no markdown fences.`,
  });

  return sanitizeBullets(toBulletHtml(raw.trim()));
};
