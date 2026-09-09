import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/ApiError.js";
import { remainingBudget, REQUEST_BUDGET_MS } from "../../utils/requestContext.js";

const client = env.aiEnabled
  ? new GoogleGenAI({ apiKey: env.GOOGLE_AI_API_KEY })
  : null;

// Total wall clock for one AI operation, spanning model fallbacks and retries.
// This MUST stay below the platform's function timeout. If the platform kills
// the function first it serves its own error page, which carries no CORS
// headers — so the browser reports a CORS failure and the real cause is
// invisible.
//
// Sized for Vercel's default ~10s function limit, which is what this project
// currently deploys under. Raising it requires raising the platform's function
// timeout first — otherwise the platform kills the request and serves its own
// error page, which carries no CORS headers and surfaces in the browser as a
// misleading CORS failure rather than the real cause.
//
// Note this is below a measured cold-start provider call (~14s against a
// warm-path ~2s), so a cold request fails cleanly rather than succeeding.
// That is the deliberate trade until the function limit is raised.
// Defaults to the whole request budget, so raising REQUEST_BUDGET_MS alone is
// enough. Two independent knobs meant a generous AI_BUDGET_MS was silently
// clamped by a smaller request budget, which looked like the AI timing out for
// no reason. Set this only to hold the AI to something tighter than the request.
const BUDGET_MS = Number(process.env.AI_BUDGET_MS ?? REQUEST_BUDGET_MS);

// Used when the configured model is missing or overloaded. An alias rather than
// a pinned version, so it survives model retirements.
const FALLBACK_MODEL = "gemini-flash-latest";

const timedOut = () =>
  ApiError.serviceUnavailable(
    "The AI provider did not respond in time. Please try again."
  );

// The AI gets whatever is left of the request's budget, not a fixed slice. The
// cold start, database connection and context queries run first, and a fixed
// budget on top of those still overran the platform's function limit.
const aiDeadline = () => {
  const budget = remainingBudget(BUDGET_MS);
  if (budget < 1_000) {
    throw ApiError.serviceUnavailable(
      "This request ran out of time before reaching the AI. Please try again."
    );
  }
  return Date.now() + budget;
};

const raceDeadline = (promise, ms) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(timedOut()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

// @google/genai ships its own class named ApiError, so a provider failure never
// satisfies the instanceof below however much its name suggests otherwise. Any
// provider error left unmapped used to propagate untouched, and the central
// handler did not recognise it either — turning "the model is busy" into an
// opaque 500.
const asApiError = (error) => {
  if (error instanceof ApiError) return error;

  const status = error?.status ?? error?.statusCode;
  if (process.env.DEBUG_RESUMEXPRESS === "1") console.info("[DEBUG-RESUMEXPRESS-AI]", { action: "provider-error", status, name: error?.name });

  if (status === 429) return ApiError.tooManyRequests("The AI provider is temporarily rate-limited or its quota is exhausted. Try again later or check the provider quota.");
  if ([401, 403].includes(status)) return ApiError.serviceUnavailable("The AI provider could not authorize this server. Check the server API key and provider permissions.");
  if (status === 404) return ApiError.serviceUnavailable("The configured AI model is unavailable. Update the server AI_MODEL setting.");
  if (typeof status === "number" && status >= 500) return ApiError.serviceUnavailable("The AI provider is busy right now. Please try again in a moment.");
  if (typeof status === "number") return ApiError.serviceUnavailable("The AI provider rejected this request. Please try again.");

  // No HTTP status means this is not a provider failure but a genuine defect in
  // our own code. Left unwrapped deliberately, so it surfaces as a 500 and gets
  // noticed rather than being disguised as a provider outage.
  return error;
};

const request = async ({ prompt, systemInstruction, json, deadline }) => {
  if (!client) {
    throw ApiError.serviceUnavailable(
      "AI features are not configured on this server"
    );
  }
  // The fallback is an alias that tracks the current flash model, so it keeps
  // resolving as versioned names are retired. It was previously the same
  // literal as the configured model, so the Set deduped it to one entry and
  // there was no fallback at all — a dead AI_MODEL simply failed outright.
  const models = [...new Set([env.AI_MODEL, FALLBACK_MODEL])].filter(Boolean);
  let lastError;
  for (const model of models) {
    const remaining = deadline - Date.now();
    if (remaining <= 250) throw lastError ?? timedOut();
    try {
      return await raceDeadline(
        client.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction,
            temperature: 0.2,
            topP: 0.95,
            maxOutputTokens: 4096,
            ...(json ? { responseMimeType: "application/json" } : {}),
          },
        }),
        remaining
      );
    } catch (error) {
      lastError = asApiError(error);
      // Worth trying the next model when this one is missing (404) or the
      // provider says it is overloaded (503) — a different model has separate
      // capacity. Our own timeout carries no `status`, so it correctly does not
      // trigger a fallback: a slow model would just burn the budget twice.
      const worthFallback = error?.status === 404 || error?.status === 503;
      if (!worthFallback || model === models.at(-1)) throw lastError;
      console.warn("[DEBUG-RESUMEXPRESS-AI] model fallback", { from: model, to: models[models.indexOf(model) + 1], status: error.status });
    }
  }
  throw lastError;
};

export const generateText = async ({ prompt, systemInstruction }) => {
  const result = await request({
    prompt,
    systemInstruction,
    json: false,
    deadline: aiDeadline(),
  });
  return result.text ?? "";
};

const parseJson = raw => {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); } catch {
    const starts = [cleaned.indexOf("{"), cleaned.indexOf("[")].filter(index => index >= 0);
    const start = starts.length ? Math.min(...starts) : -1;
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start < 0 || end <= start) throw new Error("No JSON object or array in model response");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
};

// Model output is parsed and then validated against a zod schema before it is
// returned, so malformed or unexpected JSON never reaches application logic.
export const generateStructured = async ({
  prompt,
  systemInstruction,
  schema,
  onUsage,
}) => {
  // One deadline for the whole operation, so a retry can never push the
  // function past the platform's timeout.
  const deadline = aiDeadline();
  let lastError;
  // One retry: JSON mode occasionally returns a fenced or truncated object.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw;
    try {
      const result = await request({
        prompt,
        systemInstruction,
        json: true,
        deadline,
      });
      raw = result.text ?? "";
      if (result.usageMetadata) onUsage?.({
        promptTokenCount: result.usageMetadata.promptTokenCount,
        candidatesTokenCount: result.usageMetadata.candidatesTokenCount,
        totalTokenCount: result.usageMetadata.totalTokenCount,
        cachedContentTokenCount: result.usageMetadata.cachedContentTokenCount,
        thoughtsTokenCount: result.usageMetadata.thoughtsTokenCount,
      });
    } catch (err) {
      // Provider failures are terminal. A timeout, quota or auth problem will
      // not resolve inside this request's remaining budget, and retrying one
      // is what pushed the function past the platform's timeout.
      throw asApiError(err);
    }

    try {
      const parsed = schema.safeParse(parseJson(raw));
      if (parsed.success) return parsed.data;
      lastError = parsed.error;
      console.warn("[DEBUG-RESUMEXPRESS-AI] structured validation failed", {
        attempt: attempt + 1,
        rawLength: raw.length,
        issues: parsed.error.issues.slice(0, 8).map(issue => ({ path: issue.path.join("."), code: issue.code })),
      });
    } catch (err) {
      lastError = err;
      console.warn("[DEBUG-RESUMEXPRESS-AI] structured parse failed", {
        attempt: attempt + 1,
        rawLength: raw?.length ?? 0,
        name: err?.name,
        message: err?.message,
      });
    }

    // Retrying is only worth it for a malformed response, and only if there is
    // enough budget left to make another call.
    if (deadline - Date.now() <= 250) break;
  }

  console.error("AI structured output failed validation", { name: lastError?.name, message: lastError?.message?.slice(0, 400) });

  // A schema mismatch carries zod issues; a reply that was not JSON at all
  // carries only a message. Reporting just the former left the second case
  // with no detail, which is exactly the case that then occurred.
  const detail = lastError?.issues
    ? lastError.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.code}`)
        .join("; ")
    : lastError?.message?.slice(0, 140);

  throw ApiError.serviceUnavailable(
    `The AI returned an unexpected response. Please try again.${detail ? ` (${detail})` : ""}`
  );
};

export const isAiAvailable = () => client !== null;
