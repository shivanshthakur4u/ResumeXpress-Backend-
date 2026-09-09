import { buildResumePdf, documentSections } from "./documentService.js";
import { extractPdfText } from "./jobDocumentService.js";
import { plainText } from "./atsService.js";
import { remainingBudget } from "../utils/requestContext.js";
import { ApiError } from "../utils/ApiError.js";

const DEFAULT_SECTIONS = [
  { id: "summary", type: "summary", title: "Professional Summary" },
  { id: "experience", type: "experience", title: "Experience" },
  { id: "education", type: "education", title: "Education" },
  { id: "skills", type: "skills", title: "Skills" },
];

const clean = (value) => plainText(String(value ?? "").replace(/<\/(?:li|p)>/gi, "\n").replace(/<li[^>]*>/gi, "• ")).replace(/\s+/g, " ").trim();
const tokens = (value) => clean(value).toLowerCase().match(/[a-z0-9]+/g) ?? [];
const hasSequence = (haystack, needle) => needle.length > 0 && haystack.some((_, index) => needle.every((token, offset) => haystack[index + offset] === token));

const lineIndex = (lines, value) => {
  const expected = tokens(value);
  if (!expected.length) return -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (hasSequence(tokens(lines[index]), expected)) return index;
    if (hasSequence([...tokens(lines[index]), ...tokens(lines[index + 1] ?? "")], expected)) return index;
  }
  return -1;
};

const bestLine = (lines, value) => {
  const expected = tokens(value);
  if (expected.length < 2) return null;
  let best = null;
  for (const [index, line] of lines.entries()) {
    const available = new Set(tokens(line));
    const overlap = expected.filter((token) => available.has(token)).length / expected.length;
    if (overlap >= (expected.length > 3 ? 0.45 : 0.5) && (!best || overlap > best.overlap)) {
      best = { index, value: clean(line), overlap };
    }
  }
  return best;
};

const classify = (lines, textTokens, expected, field) => {
  const exact = tokens(expected);
  if (!exact.length) return null;
  const searchable = /^(firstName|lastName)$/.test(field) ? lines.slice(0, 2).flatMap(tokens) : textTokens;
  if (hasSequence(searchable, exact)) {
    const heading = /\.title$/.test(field);
    const sameLine = heading && lines.some((line) => hasSequence(tokens(line), exact));
    return sameLine || !heading
      ? { status: "recovered", recovered: clean(expected) }
      : { status: "altered", recovered: bestLine(lines, expected)?.value ?? clean(expected) };
  }
  const altered = bestLine(lines, expected);
  if (altered) return { status: "altered", recovered: altered.value };
  return { status: "lost", recovered: null };
};

const visibleSection = (resume, section) => {
  if (section.hidden) return false;
  return documentSections({ ...resume, sections: [section] }).length > 0;
};

const addEntryFields = (fields, prefix, entry) => {
  const values = [
    ["title", entry.name || entry.title || entry.organization],
    ["role", entry.role],
    ["issuer", entry.issuer],
    ["publisher", entry.publisher],
    ["proficiency", entry.proficiency],
    ["startDate", entry.startDate || entry.issueDate || entry.date],
    ["endDate", entry.endDate || entry.expiryDate],
    ["description", entry.description],
    ["technologies", Array.isArray(entry.technologies) ? entry.technologies.join(", ") : entry.technologies],
    ["credentialId", entry.credentialId && `Credential: ${entry.credentialId}`],
    ["url", entry.url],
  ];
  for (const [name, value] of values) if (clean(value)) fields.push({ field: `${prefix}.${name}`, expected: clean(value) });
};

const expectedFields = (resume) => {
  const fields = [];
  const add = (field, value) => { if (clean(value)) fields.push({ field, expected: clean(value) }); };

  add("firstName", resume.firstName);
  add("lastName", resume.lastName);
  add("jobTitle", resume.jobTitle);
  add("address", resume.address);
  add("email", resume.email);
  add("phone", resume.phone);

  const sections = resume.sections ?? DEFAULT_SECTIONS;
  for (const section of sections) {
    if (!visibleSection(resume, section)) continue;
    const prefix = `sections.${section.id || section.type}`;
    add(`${prefix}.title`, section.title);
    if (section.entries) {
      for (const [index, entry] of section.entries.entries()) addEntryFields(fields, `${prefix}.entries.${index}`, entry);
      continue;
    }
    if (section.content !== undefined) {
      add(`${prefix}.content`, section.content);
      continue;
    }
    if (section.type === "summary") add("summary", resume.summary);
    if (section.type === "experience") {
      for (const [index, entry] of (resume.experience ?? []).entries()) {
        const base = `experience.${index}`;
        add(`${base}.title`, entry.title);
        add(`${base}.companyName`, entry.companyName);
        add(`${base}.startDate`, entry.startDate);
        add(`${base}.endDate`, entry.endDate);
        add(`${base}.workSummary`, entry.workSummary);
        if (entry.currentlyWorking && clean(entry.startDate)) add(`${base}.dateRange`, `${entry.startDate} - Present`);
      }
    }
    if (section.type === "education") {
      for (const [index, entry] of (resume.education ?? []).entries()) {
        const base = `education.${index}`;
        add(`${base}.universityName`, entry.universityName);
        add(`${base}.degree`, entry.degree);
        add(`${base}.major`, entry.major);
        add(`${base}.startDate`, entry.startDate);
        add(`${base}.endDate`, entry.endDate);
        add(`${base}.description`, entry.description);
        if (entry.currentlyStudying && clean(entry.startDate)) add(`${base}.dateRange`, `${entry.startDate} - Present`);
      }
    }
    if (section.type === "skills") {
      for (const [index, skill] of (resume.skills ?? []).entries()) add(`skills.${index}.name`, skill.name);
    }
  }
  return fields;
};

const withDeadline = async (work) => {
  const budget = remainingBudget(6_500);
  if (budget <= 0) throw ApiError.serviceUnavailable("Machine view timed out. Try again shortly.");
  let timer;
  return Promise.race([
    work(),
    new Promise((_, reject) => { timer = setTimeout(() => reject(ApiError.serviceUnavailable("Machine view timed out. Try again shortly.")), budget); }),
  ]).finally(() => clearTimeout(timer));
};

const severityRank = { high: 0, medium: 1, low: 2 };

export const analyzeMachineView = async (resume) => {
  const { rendered, rawText } = await withDeadline(async () => {
    const rendered = await buildResumePdf(resume);
    return { rendered, rawText: await extractPdfText(rendered.buffer) };
  });
  const lines = rawText.split(/\r?\n/).map((line) => clean(line)).filter(Boolean);
  const textTokens = tokens(rawText);
  const fields = expectedFields(resume).map((expected) => ({ ...expected, ...classify(lines, textTokens, expected.expected, expected.field) }));
  const sections = resume.sections ?? DEFAULT_SECTIONS;
  const visible = sections.filter((section) => visibleSection(resume, section));
  const sectionPositions = visible.map((section) => ({
    label: clean(section.title),
    index: lineIndex(lines, section.title),
  }));
  const contactIndex = Math.min(...[resume.email, resume.phone, resume.address].map((value) => lineIndex(lines, value)).filter((index) => index >= 0), Infinity);
  const foundSections = sectionPositions.filter((section) => section.index >= 0);
  const readingOrder = [...(contactIndex < Infinity ? [{ label: "Contact", index: contactIndex }] : []), ...foundSections]
    .sort((a, b) => a.index - b.index)
    .map(({ label }) => label);
  const faults = [];

  const expectedLabels = visible.map((section) => clean(section.title));
  const foundLabels = foundSections.sort((a, b) => a.index - b.index).map((section) => section.label);
  const expectedFoundLabels = expectedLabels.filter((label) => foundLabels.includes(label));
  if (expectedFoundLabels.join("\u0000") !== foundLabels.join("\u0000")) {
    faults.push({ code: "SECTION_ORDER", detail: `Parsed order: ${foundLabels.join(" > ") || "no section headings"}.`, severity: "high" });
  }
  for (const section of sectionPositions) {
    if (section.index < 0) faults.push({ code: "SECTION_HEADING_LOST", detail: `The ${section.label || "section"} heading was not recovered.`, severity: "medium" });
  }
  const experienceIndex = lineIndex(lines, "Experience");
  if (experienceIndex >= 0 && contactIndex > experienceIndex) {
    faults.push({ code: "CONTACT_AFTER_EXPERIENCE", detail: "Contact details appear after the experience section.", severity: "high" });
  }
  for (const [index, entry] of (resume.experience ?? []).entries()) {
    const employer = lineIndex(lines, entry.companyName);
    const dates = [entry.startDate, entry.endDate].filter(Boolean).map((value) => lineIndex(lines, value)).filter((value) => value >= 0);
    if (employer >= 0 && dates.some((date) => Math.abs(date - employer) > 1)) {
      faults.push({ code: "DATES_ORPHANED", detail: `Experience ${index + 1} dates are separated from ${clean(entry.companyName)}.`, severity: "high" });
    }
  }
  faults.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  const recovered = fields.filter((field) => field.status === "recovered").length;
  return {
    parsedAt: new Date().toISOString(),
    fields,
    readingOrder,
    faults,
    machineText: rawText.trim(),
    recoveryRate: fields.length ? Number((recovered / fields.length).toFixed(2)) : 0,
    pages: rendered.pages,
    warnings: rendered.warnings,
  };
};
