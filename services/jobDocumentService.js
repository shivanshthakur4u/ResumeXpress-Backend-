import { ApiError } from "../utils/ApiError.js";
import { remainingBudget } from "../utils/requestContext.js";

let active = 0;
const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
const MAX_PAGES = 20;
const MIN_TEXT = 80;
const MAX_TEXT = 30000;

// Parsing runs inline rather than in a worker thread. The worker gave
// interruptibility, but it also spawned the module in a second realm via
// new URL(import.meta.url), which is fragile once the function is bundled for
// deployment — and its failures collapsed into one generic message. The page
// and byte caps below bound the work instead.
const parsers = {
  async pdf(buffer) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer, isEvalSupported: false });
    try {
      const info = await parser.getInfo();
      if (info.total > MAX_PAGES) {
        throw ApiError.badRequest(
          `Use a document with at most ${MAX_PAGES} pages (this one has ${info.total}).`
        );
      }
      return (await parser.getText({ pageJoiner: "" })).text;
    } finally {
      await parser.destroy();
    }
  },

  async docx(buffer) {
    const { default: mammoth } = await import("mammoth");
    return (await mammoth.extractRawText({ buffer })).value;
  },
};

// Strips NUL bytes, which PDF text extraction can emit and Mongo rejects.
const clean = (text) => String(text ?? "").replace(/\u0000/g, "").trim();

const assertUsable = (text) => {
  if (text.length < MIN_TEXT) {
    throw ApiError.badRequest(
      `Not enough readable text (found ${text.length} characters). Scanned or image-only documents cannot be read — paste at least ${MIN_TEXT} characters instead.`
    );
  }
  if (text.length > MAX_TEXT) {
    throw ApiError.badRequest(
      `The document is too long. Paste the relevant text (up to ${MAX_TEXT} characters).`
    );
  }
  return text;
};

export const extractJobDocument = async ({ filename, content }) => {
  const format = filename.toLowerCase().split(".").pop();
  const buffer = Buffer.from(content, "base64");

  if (
    !["pdf", "docx", "txt", "md"].includes(format) ||
    !buffer.length ||
    buffer.length > MAX_DOCUMENT_BYTES
  ) {
    throw ApiError.badRequest(
      "Choose a PDF, DOCX, TXT or Markdown file smaller than 3 MB."
    );
  }

  if (
    (format === "pdf" && buffer.subarray(0, 5).toString() !== "%PDF-") ||
    (format === "docx" && buffer.subarray(0, 2).toString() !== "PK")
  ) {
    throw ApiError.badRequest("The file does not match its PDF or DOCX extension.");
  }

  if (["txt", "md"].includes(format)) {
    return { text: assertUsable(clean(buffer.toString("utf8"))) };
  }

  if (active >= 2) {
    throw ApiError.tooManyRequests("Document imports are busy. Try again shortly.");
  }

  active += 1;
  try {
    const budget = remainingBudget(15_000);
    let timer;
    const text = await Promise.race([
      parsers[format](buffer),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              ApiError.badRequest(
                "This document took too long to read. Paste its text instead."
              )
            ),
          budget
        );
      }),
    ]).finally(() => clearTimeout(timer));

    return { text: assertUsable(clean(text)) };
  } catch (error) {
    if (error instanceof ApiError) throw error;

    // The underlying reason used to be swallowed into one generic sentence,
    // which made a corrupt file, an encrypted file and a missing dependency
    // indistinguishable to both the user and the logs.
    console.error("[DEBUG-RESUMEXPRESS-DOCUMENT] parser failure", {
      format,
      bytes: buffer.length,
      name: error?.name,
      message: error?.message,
      code: error?.code,
    });

    const reason = String(error?.message ?? "unknown error").slice(0, 160);
    throw ApiError.badRequest(
      `Could not read this ${format.toUpperCase()}. Use an unlocked file or paste the text. (${reason})`
    );
  } finally {
    active -= 1;
  }
};
