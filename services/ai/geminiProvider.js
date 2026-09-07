import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/ApiError.js";

const client = env.aiEnabled
  ? new GoogleGenAI({ apiKey: env.GOOGLE_AI_API_KEY })
  : null;

const REQUEST_TIMEOUT_MS = 9_000;
const MODEL_TIMEOUT_MS = 4_000;

const withTimeout = async (promise, ms) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(ApiError.serviceUnavailable("AI request timed out")), ms); })]); }
  catch (error) {
    if (process.env.DEBUG_RESUMEXPRESS === "1") console.info("[DEBUG-RESUMEXPRESS-AI]", { action: "provider-error", status: error.status ?? error.statusCode, name: error.name });
    if (error.status === 429) throw ApiError.tooManyRequests("The AI provider is temporarily rate-limited or its quota is exhausted. Try again later or check the provider quota.");
    if ([401, 403].includes(error.status)) throw ApiError.serviceUnavailable("The AI provider could not authorize this server. Check the server API key and provider permissions.");
    if (error.status === 404) throw ApiError.serviceUnavailable("The configured AI model is unavailable. Update the server AI_MODEL setting.");
    throw error;
  }
  finally { clearTimeout(timer); }
};

const request = async ({ prompt, systemInstruction, json }) => {
  if (!client) {
    throw ApiError.serviceUnavailable(
      "AI features are not configured on this server"
    );
  }
  const models = [...new Set([env.AI_MODEL, "gemini-3.6-flash"])]
    .filter(Boolean);
  let lastError;
  for (const model of models) {
    try {
      return await Promise.race([
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
        new Promise((_, reject) => setTimeout(() => { const error = new Error("Gemini model request timed out"); error.status = 503; reject(error); }, MODEL_TIMEOUT_MS)),
      ]);
    } catch (error) {
      lastError = error;
      if (![404, 503].includes(error.status) || model === models.at(-1)) throw error;
      console.warn("[DEBUG-RESUMEXPRESS-AI] model fallback", { from: model, to: models[models.indexOf(model) + 1], status: error.status });
    }
  }
  throw lastError;
};

export const generateText = async ({ prompt, systemInstruction }) => {
  const result = await withTimeout(
    request({ prompt, systemInstruction, json: false }),
    REQUEST_TIMEOUT_MS
  );
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
  let lastError;
  // One retry: JSON mode occasionally returns a fenced or truncated object.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw;
    try {
      const result = await withTimeout(
        request({ prompt, systemInstruction, json: true }),
        REQUEST_TIMEOUT_MS
      );
      raw = result.text ?? "";
      if (result.usageMetadata) onUsage?.({
        promptTokenCount: result.usageMetadata.promptTokenCount,
        candidatesTokenCount: result.usageMetadata.candidatesTokenCount,
        totalTokenCount: result.usageMetadata.totalTokenCount,
        cachedContentTokenCount: result.usageMetadata.cachedContentTokenCount,
        thoughtsTokenCount: result.usageMetadata.thoughtsTokenCount,
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      lastError = err;
      continue;
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
  }

  console.error("AI structured output failed validation", { name: lastError?.name });
  throw ApiError.serviceUnavailable(
    "The AI returned an unexpected response. Please try again."
  );
};

export const isAiAvailable = () => client !== null;
