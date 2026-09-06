import PDFDocument from "pdfkit";
import { plainText } from "./atsService.js";
const defaultSections = ["summary", "experience", "education", "skills"].map(type => ({ type, title: type === "summary" ? "Professional Summary" : type[0].toUpperCase() + type.slice(1) }));
export const documentSections = resume => (resume.sections ?? defaultSections).filter(section => !section.hidden).map(section => {
  let entries;
  if (section.content !== undefined) entries = [{ body: section.content }];
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
  const accent = /^#[0-9a-f]{6}$/i.test(resume.themeColor ?? "") ? resume.themeColor : "#243447";
  let font = resume.typography === "serif" || ["executive", "academic"].includes(template) ? "Times-Roman" : resume.typography === "mono" ? "Courier" : "Helvetica";
  let bold = font === "Times-Roman" ? "Times-Bold" : font === "Courier" ? "Courier-Bold" : "Helvetica-Bold";
  if (process.env.PDF_FONT_PATH) { doc.registerFont("Custom", process.env.PDF_FONT_PATH); font = "Custom"; bold = "Custom"; }
  const base = Math.max(9, Math.min(14, resume.fontSize ?? 11));
  const gap = base * (Math.max(1, Math.min(1.8, resume.spacing ?? 1.4)) - 1);
  const width = doc.page.width - 72;
  const ensure = height => { if (doc.y + height > doc.page.height - 36) doc.addPage(); };
  let bodyWidth = width;
  const text = (value, options = {}) => { if (value) doc.text(value, { width: bodyWidth, lineGap: gap, ...options }); };
  const centered = ["executive", "academic", "legacy"].includes(template);
  doc.font(bold).fontSize(template === "executive" ? 30 : 25).fillColor(template === "ats-minimal" ? "#111111" : accent);
  text(`${resume.firstName ?? ""} ${resume.lastName ?? ""}`.trim(), { align: centered ? "center" : "left" });
  doc.font(font).fontSize(base + 2).fillColor("#17202b"); text(resume.jobTitle, { align: centered ? "center" : "left" });
  doc.fontSize(base - 1); text(resume.address, { align: centered ? "center" : "left" });
  if (resume.email) text(resume.email, { link: `mailto:${resume.email}`, align: centered ? "center" : "left" });
  if (resume.phone) text(resume.phone, { link: `tel:${resume.phone}`, align: centered ? "center" : "left" });
  if (["professional", "executive", "legacy"].includes(template)) { doc.moveDown(.4); doc.moveTo(36, doc.y).lineTo(doc.page.width - 36, doc.y).strokeColor(accent).lineWidth(template === "professional" ? 2 : .6).stroke(); }
  doc.moveDown(.7);
  const sections = documentSections(resume);
  for (const [i, section] of sections.entries()) {
    ensure(base * 6);
    doc.font(template === "technical" ? "Courier-Bold" : bold).fontSize(base + 1).fillColor(template === "ats-minimal" ? "#111111" : accent);
    const heading = template === "academic" ? `${i + 1}. ${section.title}` : template === "ats-minimal" ? section.title.toUpperCase() : section.title;
    if (template === "modern") {
      const top = doc.y;
      doc.text(heading, 36, top, { width: 105 });
      doc.x = 155; doc.y = top; bodyWidth = doc.page.width - 191;
    } else text(heading);
    if (["professional", "academic"].includes(template)) { doc.moveTo(36, doc.y).lineTo(doc.page.width - 36, doc.y).strokeColor("#c5cbd1").lineWidth(.5).stroke(); }
    doc.moveDown(.35);
    for (const entry of section.entries) {
      ensure(base * (entry.title ? 4 : 2));
      doc.font(bold).fontSize(base).fillColor("#17202b"); text(entry.title);
      doc.font(font).fontSize(base - .5); text(entry.meta);
      doc.fontSize(base); text(entry.body, { indent: template === "academic" ? 12 : 0 });
      doc.moveDown(.55);
    }
    doc.x = 36; bodyWidth = width;
    doc.moveDown(.35);
  }
  const pages = doc.bufferedPageRange().count;
  const warnings = [];
  if (pages > 2) warnings.push(`This resume spans ${pages} pages. Review relevance or reduce spacing.`);
  if (!sections.length) warnings.push("This resume has no visible content sections.");
  if (doc.y < doc.page.height * .35 && pages > 1) warnings.push("The final page has substantial unused space.");
  doc.on("end", () => resolve({ buffer: Buffer.concat(chunks), pages, warnings }));
  doc.end();
});
