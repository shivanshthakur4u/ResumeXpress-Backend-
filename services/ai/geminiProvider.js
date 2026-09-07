import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/ApiError.js";

const client = env.aiEnabled
  ? new GoogleGenAI({ apiKey: env.GOOGLE_AI_API_KEY })
  : null;

// Total wall clock for one AI operation, spanning model fallbacks and retries.
// This MUST stay below the platform's function timeout. If the platform kills
// the function first it serves its own error page, which carries no CORS
// headers — so the browser reports a CORS failure and the real cause is
// invisible.
//
// Kept deliberately in step with vercel.json's maxDuration (60s), with a wide
// margin for the database round trips either side. The ceiling is sized for a
// cold provider connection, measured at ~14s against a warm-path ~2s; it is a
// safety net, not a target. If you deploy somewhere with a lower function
// limit, lower this to match or the platform will kill the request first.
const BUDGET_MS = Number(process.env.AI_BUDGET_MS ?? 25_000);

const timedOut = () =>
  ApiError.serviceUnavailable(
    "The AI provider did not respond in time. Please try again."
  );

const raceDeadline = (promise, ms) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(timedOut()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

const asApiError = (error) => {
  if (error instanceof ApiError) return error;
  if (process.env.DEBUG_RESUMEXPRESS === "1") console.info("[DEBUG-RESUMEXPRESS-AI]", { action: "provider-error", status: error.status ?? error.statusCode, name: error.name });
  if (error.status === 429) return ApiError.tooManyRequests("The AI provider is temporarily rate-limited or its quota is exhausted. Try again later or check the provider quota.");
  if ([401, 403].includes(error.status)) return ApiError.serviceUnavailable("The AI provider could not authorize this server. Check the server API key and provider permissions.");
  if (error.status === 404) return ApiError.serviceUnavailable("The configured AI model is unavailable. Update the server AI_MODEL setting.");
  return error;
};

const request = async ({ prompt, systemInstruction, json, deadline }) => {
  if (!client) {
    throw ApiError.serviceUnavailable(
      "AI features are not configured on this server"
    );
  }
  const models = [...new Set([env.AI_MODEL, "gemini-3.6-flash"])]
    .filter(Boolean);
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
      // Only a genuinely missing model is worth trying the fallback for. A
      // timeout previously fell through to here too, which meant a slow model
      // burned the budget twice over for the same outcome.
      if (error.status !== 404 || model === models.at(-1)) throw lastError;
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
    deadline: Date.now() + BUDGET_MS,
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
  const deadline = Date.now() + BUDGET_MS;
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

  console.error("AI structured output failed validation", { name: lastError?.name });
  throw ApiError.serviceUnavailable(
    "The AI returned an unexpected response. Please try again."
  );
};

export const isAiAvailable = () => client !== null;
