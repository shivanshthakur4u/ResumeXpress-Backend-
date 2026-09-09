import { buildResumePdf } from "./documentService.js";
import { findOwnedResume } from "./resumeService.js";

const words = (value) => String(value ?? "").trim().split(/\s+/).filter(Boolean);
const concrete = (value) => /\d/.test(value) || /\b(?:%|k|m|x)\b/i.test(value);

export const analyzeScan = async ({ id, userEmail }) => {
  const resume = await findOwnedResume(id, userEmail);
  const rendered = await buildResumePdf(resume);
  const fold = rendered.pageHeight / 3;
  const zone = rendered.layoutBlocks.filter(block => block.page === 1 && block.y <= fold);
  const pageOne = rendered.layoutBlocks.filter(block => block.page === 1).sort((a, b) => a.y - b.y);
  const contactWords = zone.filter(block => block.type === "contact").reduce((total, block) => total + words(block.text).length, 0);
  const zoneWords = zone.reduce((total, block) => total + words(block.text).length, 0);
  const titlePresent = zone.some(block => block.type === "jobTitle");
  const employerVisible = (resume.experience ?? []).some(entry => entry.companyName && zone.some(block => block.type !== "contact" && block.text.toLowerCase().includes(entry.companyName.toLowerCase())));
  const firstAchievement = pageOne.findIndex(block => ["entryBody", "summary"].includes(block.type) && concrete(block.text));
  const beforeAchievement = firstAchievement < 0 ? pageOne.reduce((total, block) => total + words(block.text).length, 0) : pageOne.slice(0, firstAchievement).reduce((total, block) => total + words(block.text).length, 0);
  const containsNumber = zone.some(block => concrete(block.text));
  const missing = [
    !titlePresent && "Job title is below the scan zone.",
    !employerVisible && "No employer name is visible in the scan zone.",
    !containsNumber && "No measurable result appears in the scan zone.",
  ].filter(Boolean);
  const verdict = missing.length ? missing[0] : "Your role, employer and a concrete result appear in the first scan zone.";
  return {
    page: 1,
    zoneHeight: fold,
    zone,
    jobTitlePresent: titlePresent,
    employerVisible,
    containsNumber,
    wordCountBeforeFirstAchievement: beforeAchievement,
    contactProportion: zoneWords ? Number((contactWords / zoneWords).toFixed(2)) : 0,
    verdict,
    missing,
    pages: rendered.pages,
  };
};
