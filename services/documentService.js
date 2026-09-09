import PDFDocument from "pdfkit";
import { plainText } from "./atsService.js";
const defaultSections = ["summary", "experience", "education", "skills"].map(type => ({ type, title: type === "summary" ? "Professional Summary" : type[0].toUpperCase() + type.slice(1) }));
export const documentSections = resume => (resume.sections ?? defaultSections).filter(section => !section.hidden).map(section => {
  let entries;
  if (section.entries) entries = section.entries.map(entry => ({
    title: entry.name || entry.title || entry.organization,
    meta: [entry.role, entry.issuer, entry.publisher, entry.proficiency, [entry.startDate || entry.issueDate || entry.date, entry.endDate || entry.expiryDate].filter(Boolean).join(" - ")].filter(Boolean).join(" | "),
    body: [entry.description, entry.technologies?.join(", "), entry.credentialId && `Credential: ${entry.credentialId}`, entry.url].filter(Boolean).join("\n"),
    url: /^https?:\/\//i.test(entry.url ?? "") ? entry.url : undefined,
  }));
  else if (section.content !== undefined) entries = [{ body: section.content }];
  else if (section.type === "summary") entries = [{ body: resume.summary }];
  else if (section.type === "experience") entries = (resume.experience ?? []).map(e => ({ title: e.title, meta: [e.companyName, [e.startDate, e.currentlyWorking ? "Present" : e.endDate].filter(Boolean).join(" - ")].filter(Boolean).join(" | "), body: e.workSummary }));
  else if (section.type === "education") entries = (resume.education ?? []).map(e => ({ title: e.universityName, meta: [e.degree, e.major, [e.startDate, e.currentlyStudying ? "Present" : e.endDate].filter(Boolean).join(" - ")].filter(Boolean).join(" | "), body: e.description }));
  else if (section.type === "skills") entries = [{ body: (resume.skills ?? []).map(s => s.name).filter(Boolean).join("  |  ") }];
  else entries = [{ body: section.content }];
  return { title: section.title, entries: entries.filter(e => e.title || e.meta || e.body).map(e => ({ ...e, body: plainText((e.body ?? "").replace(/<\/(?:li|p)>/gi, "\n").replace(/<li[^>]*>/gi, "• ")) })) };
}).filter(s => s.entries.length);
export const buildResumePdf = resume => new Promise((resolve, reject) => {
  const size = resume.paperSize === "Letter" ? "LETTER" : "A4";
  const doc = new PDFDocument({ size, margin: 36, bufferPages: true, info: { Title: resume.title || "Resume", Author: `${resume.firstName ?? ""} ${resume.lastName ?? ""}`.trim() } });
  const chunks = []; doc.on("data", chunk => chunks.push(chunk)); doc.on("error", reject);
  const template = resume.template ?? "legacy";
  const layoutBlocks = [];
  let currentPage = 1;
  const accent = /^#[0-9a-f]{6}$/i.test(resume.themeColor ?? "") ? resume.themeColor : "#243447";
  let font = resume.typography === "serif" || ["executive", "academic"].includes(template) ? "Times-Roman" : resume.typography === "mono" ? "Courier" : "Helvetica";
  let bold = font === "Times-Roman" ? "Times-Bold" : font === "Courier" ? "Courier-Bold" : "Helvetica-Bold";
  if (process.env.PDF_FONT_PATH) { doc.registerFont("Custom", process.env.PDF_FONT_PATH); font = "Custom"; bold = "Custom"; }
  const base = Math.max(9, Math.min(14, resume.fontSize ?? 11));
  const gap = base * (Math.max(1, Math.min(1.8, resume.spacing ?? 1.4)) - 1);
  const width = doc.page.width - 72;
  let bodyX = 36;
  let bodyWidth = width;
  doc.on("pageAdded", () => { currentPage += 1; doc.x = bodyX; });
  const ensure = height => { if (doc.y > 36 && doc.y + height > doc.page.height - 36) doc.addPage(); };
  const text = (value, options = {}, block) => {
    if (!value) return;
    const y = doc.y;
    const page = currentPage;
    doc.text(value, { width: bodyWidth, lineGap: gap, ...options });
    if (block) layoutBlocks.push({ ...block, page, y, height: Math.max(0, doc.y - y), text: plainText(value) });
  };
  const centered = ["executive", "academic", "legacy"].includes(template);
  doc.font(bold).fontSize(template === "executive" ? 30 : 25).fillColor(template === "ats-minimal" ? "#111111" : accent);
  text(`${resume.firstName ?? ""} ${resume.lastName ?? ""}`.trim(), { align: centered ? "center" : "left" }, { type: "name", label: "Name" });
  doc.font(font).fontSize(base + 2).fillColor("#17202b"); text(resume.jobTitle, { align: centered ? "center" : "left" }, { type: "jobTitle", label: "Job title" });
  doc.fontSize(base - 1); text(resume.address, { align: centered ? "center" : "left" }, { type: "contact", label: "Address" });
  if (resume.email) text(resume.email, { link: `mailto:${resume.email}`, align: centered ? "center" : "left" }, { type: "contact", label: "Email" });
  if (resume.phone) text(resume.phone, { link: `tel:${resume.phone}`, align: centered ? "center" : "left" }, { type: "contact", label: "Phone" });
  if (["professional", "executive", "legacy"].includes(template)) { doc.moveDown(.4); doc.moveTo(36, doc.y).lineTo(doc.page.width - 36, doc.y).strokeColor(accent).lineWidth(template === "professional" ? 2 : .6).stroke(); }
  doc.moveDown(.7);
  const sections = documentSections(resume);
  for (const [i, section] of sections.entries()) {
    bodyX = template === "modern" ? 155 : 36;
    bodyWidth = width - (bodyX - 36);
    doc.x = bodyX;
    const first = section.entries[0];
    doc.font(bold).fontSize(base);
    const firstTitleHeight = first.title ? doc.heightOfString(first.title, { width: bodyWidth, lineGap: gap }) : 0;
    doc.font(font).fontSize(base - .5);
    const firstMetaHeight = first.meta ? doc.heightOfString(first.meta, { width: bodyWidth, lineGap: gap }) : 0;
    ensure(Math.min(doc.page.height - 72, firstTitleHeight + firstMetaHeight + base * 6));
    doc.font(template === "technical" ? "Courier-Bold" : bold).fontSize(base + 1).fillColor(template === "ats-minimal" ? "#111111" : accent);
    const heading = template === "academic" ? `${i + 1}. ${section.title}` : template === "ats-minimal" ? section.title.toUpperCase() : section.title;
    let headingBottom = doc.y;
    const headingPage = doc.bufferedPageRange().count;
    if (template === "modern") {
      const top = doc.y;
      doc.text(heading, 36, top, { width: 105 });
      layoutBlocks.push({ type: "sectionHeading", label: section.title, page: currentPage, y: top, height: Math.max(0, doc.y - top), text: plainText(heading) });
      headingBottom = doc.y;
      doc.x = bodyX; doc.y = top;
    } else text(heading, {}, { type: "sectionHeading", label: section.title });
    if (["professional", "academic"].includes(template)) { doc.moveTo(36, doc.y).lineTo(doc.page.width - 36, doc.y).strokeColor("#c5cbd1").lineWidth(.5).stroke(); }
    doc.moveDown(.35);
    for (const entry of section.entries) {
      doc.font(bold).fontSize(base);
      const titleHeight = entry.title ? doc.heightOfString(entry.title, { width: bodyWidth, lineGap: gap }) : 0;
      doc.font(font).fontSize(base - .5);
      const metaHeight = entry.meta ? doc.heightOfString(entry.meta, { width: bodyWidth, lineGap: gap }) : 0;
      doc.fontSize(base);
      const bodyHeight = entry.body ? doc.heightOfString(entry.body, { width: bodyWidth, lineGap: gap }) : 0;
      const entryHeight = titleHeight + metaHeight + bodyHeight;
      // Keep ordinary entries together; long entries can continue across pages.
      const minimum = titleHeight + metaHeight + Math.min(bodyHeight, base * 3);
      ensure(Math.min(doc.page.height - 72, entry === first ? minimum : entryHeight <= doc.page.height - 72 ? entryHeight : minimum));
      doc.font(bold).fontSize(base).fillColor("#17202b"); text(entry.title, {}, { type: "entryTitle", label: section.title });
      doc.font(font).fontSize(base - .5); text(entry.meta, {}, { type: "entryMeta", label: section.title });
      doc.fontSize(base); text(entry.body, { indent: template === "academic" ? 12 : 0, ...(entry.url ? { link: entry.url } : {}) }, { type: "entryBody", label: section.title });
      doc.moveDown(.55);
    }
    if (headingPage === doc.bufferedPageRange().count) doc.y = Math.max(doc.y, headingBottom);
    bodyX = 36; doc.x = 36; bodyWidth = width;
    doc.moveDown(.35);
  }
  const pages = doc.bufferedPageRange().count;
  const warnings = [];
  if (pages > 2) warnings.push(`This resume spans ${pages} pages. Review relevance or reduce spacing.`);
  if (!sections.length) warnings.push("This resume has no visible content sections.");
  if (doc.y < doc.page.height * .35 && pages > 1) warnings.push("The final page has substantial unused space.");
  const lastPageFill = Math.min(1, Math.max(0, (doc.y - 36) / (doc.page.height - 72)));
  doc.on("end", () => resolve({ buffer: Buffer.concat(chunks), pages, warnings, lastPageFill, layoutBlocks, pageHeight: doc.page.height, pageWidth: doc.page.width }));
  doc.end();
});

export const optimizeResumeLayout = async resume => {
  const before = await buildResumePdf(resume);
  const original = { fontSize: resume.fontSize ?? 11, spacing: resume.spacing ?? 1.4 };
  let settings = original, best = before;
  if (before.pages > 1) {
    // Bounded search preserves readable text and the user's chosen template.
    for (const fontSize of [...new Set([original.fontSize, Math.max(10, original.fontSize - .5), Math.max(10, original.fontSize - 1)])].filter(size => size <= original.fontSize)) {
      for (const spacing of [...new Set([original.spacing, Math.min(original.spacing, 1.2), Math.min(original.spacing, 1.1)])]) {
        if (fontSize === original.fontSize && spacing === original.spacing) continue;
        const candidate = await buildResumePdf({ ...resume, fontSize, spacing });
        if (candidate.pages < best.pages) { settings = { fontSize, spacing }; best = candidate; }
        if (best.pages === 1) break;
      }
      if (best.pages === 1) break;
    }
  }
  if (process.env.DEBUG_RESUMEXPRESS === "1") console.info("[DEBUG-RESUMEXPRESS] layout", { beforePages: before.pages, afterPages: best.pages });
  return { beforePages: before.pages, pages: best.pages, settings, changed: best.pages < before.pages, warnings: best.warnings };
};

export const buildCoverLetterPdf = (letter, paperSize = "A4") => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ size: paperSize === "Letter" ? "LETTER" : "A4", margin: 54, info: { Title: letter.title || "Cover letter" } });
  const chunks = [];
  doc.on("data", chunk => chunks.push(chunk)); doc.on("error", reject);
  doc.on("end", () => resolve(Buffer.concat(chunks)));
  if (process.env.PDF_FONT_PATH) doc.font(process.env.PDF_FONT_PATH);
  else doc.font("Helvetica");
  doc.fontSize(11).fillColor("#17202b").text(letter.content, { lineGap: 4, paragraphGap: 10 });
  doc.end();
});
