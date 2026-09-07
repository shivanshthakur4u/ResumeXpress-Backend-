import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { ApiError } from "../utils/ApiError.js";

let active = 0;
export const extractJobDocument = ({ filename, content }) => {
  const format = filename.toLowerCase().split(".").pop();
  const buffer = Buffer.from(content, "base64");
  if (!["pdf", "docx"].includes(format) || !buffer.length || buffer.length > 512 * 1024) throw ApiError.badRequest("Choose a PDF or DOCX file smaller than 512 KB.");
  if ((format === "pdf" && buffer.subarray(0, 5).toString() !== "%PDF-") || (format === "docx" && buffer.subarray(0, 2).toString() !== "PK")) throw ApiError.badRequest("The file does not match its PDF or DOCX extension.");
  // ponytail: two parsers per process; use a bounded job queue for larger deployments.
  if (active >= 2) throw ApiError.tooManyRequests("Document imports are busy. Try again shortly.");
  active += 1;
  let worker, timer;
  return new Promise((resolve, reject) => {
    worker = new Worker(new URL(import.meta.url), { workerData: { format, buffer }, resourceLimits: { maxOldGenerationSizeMb: 192 }, execArgv: [] });
    timer = setTimeout(() => reject(ApiError.badRequest("This document took too long to read. Paste its text instead.")), 10000);
    worker.once("message", result => result.error ? reject(ApiError.badRequest(result.error)) : resolve(result));
    worker.once("error", () => reject(ApiError.badRequest("Could not read the document. Try a smaller file or paste its text.")));
    worker.once("exit", code => { if (code !== 0) reject(ApiError.badRequest("Document import stopped. Paste its text instead.")); });
  }).finally(async () => { clearTimeout(timer); await worker?.terminate(); active -= 1; });
};

if (!isMainThread) {
  try {
    const buffer = Buffer.from(workerData.buffer);
    let text;
    if (workerData.format === "pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer, isEvalSupported: false });
      try {
        const info = await parser.getInfo();
        if (info.total > 20) throw new Error("Use a document with at most 20 pages.");
        text = (await parser.getText({ pageJoiner: "" })).text;
      } finally { await parser.destroy(); }
    } else {
      const { default: mammoth } = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer })).value;
    }
    text = text.replace(/\u0000/g, "").trim();
    if (text.length < 80) parentPort.postMessage({ error: "Not enough readable text. For scanned documents, paste at least 80 characters of text instead." });
    else if (text.length > 30000) parentPort.postMessage({ error: "The document is too long. Paste the relevant text (up to 30,000 characters)." });
    else parentPort.postMessage({ text });
  } catch (error) {
    console.warn("[DEBUG-RESUMEXPRESS-DOCUMENT] parser failure", {
      format: workerData.format,
      bytes: workerData.buffer.length,
      name: error?.name,
      message: error?.message,
    });
    parentPort.postMessage({ error: "Could not read this document. Use an unlocked PDF or DOCX, or paste the text." });
  }
}
