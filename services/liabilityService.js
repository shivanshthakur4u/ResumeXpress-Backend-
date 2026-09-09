import { Evidence } from "../Models/Evidence.Model.js";
import { plainText } from "./atsService.js";
import { scoreStatement, splitStatements } from "./authenticityService.js";
import { findOwnedResume } from "./resumeService.js";

const clean = (value) => plainText(String(value ?? "")).replace(/\s+/g, " ").trim();
const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const valueAtPath = (resume, path) => path.split(".").reduce((value, segment) => value == null ? undefined : value[segment], resume);
const currentClaimText = (value) => typeof value === "string" ? clean(value) : JSON.stringify(value ?? null);
const hasMetric = (text) => /\b\d+(?:[.,]\d+)*(?:%|k|m|x)?\b/i.test(text);
const seniorityVerb = (text) => text.match(/\b(led|owned|architected|managed|directed|drove|founded|launched)\b/i)?.[1];

const evidenceFor = (items, claim, resume) => items.filter(item => {
  if (item.claim.path !== claim.path) return false;
  const claimText = normalize(claim.text);
  const storedText = normalize(item.claim.text);
  return claimText && (claimText.includes(storedText) || storedText.includes(claimText));
}).map(item => {
  const current = valueAtPath(resume, item.claim.path);
  return { item, stale: current === undefined || currentClaimText(current) !== item.claim.text };
});

const makeClaim = (claims, path, text, score, extra = {}) => {
  const cleaned = clean(text);
  if (cleaned) claims.push({ path, text: cleaned, score, ...extra });
};

export const analyzeLiability = async ({ id, userEmail }) => {
  const resume = await findOwnedResume(id, userEmail);
  const evidence = await Evidence.find({ userEmail, "claim.resume": resume._id }).sort({ createdAt: -1 }).lean();
  const claims = [];
  if (resume.summary) for (const statement of splitStatements(resume.summary)) makeClaim(claims, "summary", statement, scoreStatement(statement));
  for (const [index, entry] of (resume.experience ?? []).entries()) {
    for (const statement of splitStatements(entry.workSummary)) makeClaim(claims, `experience.${index}.workSummary`, statement, scoreStatement(statement));
  }
  for (const [index, entry] of (resume.education ?? []).entries()) {
    for (const statement of splitStatements(entry.description)) makeClaim(claims, `education.${index}.description`, statement, scoreStatement(statement));
  }
  const experienceText = (resume.experience ?? []).map(entry => `${entry.title ?? ""} ${entry.workSummary ?? ""}`).join(" ");
  for (const [index, skill] of (resume.skills ?? []).entries()) {
    if (skill.name && !normalize(experienceText).includes(normalize(skill.name))) makeClaim(claims, `skills.${index}.name`, skill.name, { score: 100, skillMissing: true });
  }

  const results = claims.map(claim => {
    const matches = evidenceFor(evidence, claim, resume);
    const attached = matches[0];
    const reasons = [];
    const drill = [];
    let exposure = 20;
    if (hasMetric(claim.text)) {
      const metric = claim.text.match(/\b\d+(?:[.,]\d+)*(?:%|k|m|x)?\b/i)?.[0];
      exposure += 25;
      reasons.push(`Contains the metric ${metric} and needs a verifiable basis.`);
      drill.push(`What was the baseline, timeframe and measurement method for ${metric}?`);
    }
    const verb = seniorityVerb(claim.text);
    if (verb) {
      exposure += 15;
      reasons.push(`Uses the seniority verb "${verb}", which invites scope questions.`);
      drill.push("What decisions did you own, and who was affected by them?");
    }
    if (claim.skillMissing) {
      exposure += 25;
      reasons.push(`Skill "${claim.text}" is listed but does not appear in the experience record.`);
      drill.push(`Where did you use ${claim.text} in a real project?`);
    }
    if (!claim.skillMissing && claim.score.score < 75) {
      exposure += Math.round((75 - claim.score.score) * 0.35);
      reasons.push(`Specificity check scored ${claim.score.score}/100 for this statement.`);
      drill.push("What specific action and result can you defend for this line?");
    }
    if (!attached) {
      exposure += 25;
      reasons.push("No evidence is attached to this claim.");
      drill.push("Which document, dashboard or person can verify this claim?");
    } else if (attached.stale) {
      exposure += 20;
      reasons.push("Attached evidence is stale because the claim changed afterward.");
      drill.push("Update this evidence so it matches the current wording.");
    } else {
      const reduction = attached.item.confidence === "confirmed" ? 35 : attached.item.confidence === "estimated" ? 20 : 10;
      exposure -= reduction;
    }
    return {
      path: claim.path,
      text: claim.text,
      exposure: Math.max(0, Math.min(100, exposure)),
      reasons,
      drill: [...new Set(drill)].slice(0, 3),
      evidenceId: attached?.item._id ?? null,
      evidenceStale: attached?.stale ?? false,
    };
  }).sort((a, b) => b.exposure - a.exposure || a.path.localeCompare(b.path));
  return { overallExposure: results.length ? Math.round(results.reduce((sum, claim) => sum + claim.exposure, 0) / results.length) : 0, claims: results };
};
