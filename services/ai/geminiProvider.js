import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/ApiError.js";

const client = env.aiEnabled
  ? new GoogleGenerativeAI(env.GOOGLE_AI_API_KEY)
  : null;

const REQUEST_TIMEOUT_MS = 30_000;

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

const getModel = ({ json, systemInstruction }) => {
  if (!client) {
    throw ApiError.serviceUnavailable(
      "AI features are not configured on this server"
    );
  }
  return client.getGenerativeModel({
    model: env.AI_MODEL,
    systemInstruction,
    generationConfig: {
      temperature: 0.2,
      topP: 0.95,
      maxOutputTokens: 4096,
      ...(json ? { responseMimeType: "application/json" } : {}),
    },
  });
};

export const generateText = async ({ prompt, systemInstruction }) => {
  const model = getModel({ json: false, systemInstruction });
  const result = await withTimeout(
    model.generateContent(prompt),
    REQUEST_TIMEOUT_MS
  );
  return result.response.text();
};

// Model output is parsed and then validated against a zod schema before it is
// returned, so malformed or unexpected JSON never reaches application logic.
export const generateStructured = async ({
  prompt,
  systemInstruction,
  schema,
  onUsage,
}) => {
  const model = getModel({ json: true, systemInstruction });

  let lastError;
  // One retry: JSON mode occasionally returns a fenced or truncated object.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw;
    try {
      const result = await withTimeout(
        model.generateContent(prompt),
        REQUEST_TIMEOUT_MS
      );
      raw = result.response.text();
      if (result.response.usageMetadata) onUsage?.(result.response.usageMetadata);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      lastError = err;
      continue;
    }

    try {
      const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
      const parsed = schema.safeParse(JSON.parse(cleaned));
      if (parsed.success) return parsed.data;
      lastError = parsed.error;
    } catch (err) {
      lastError = err;
    }
  }

  console.error("AI structured output failed validation", { name: lastError?.name });
  throw ApiError.serviceUnavailable(
    "The AI returned an unexpected response. Please try again."
  );
};

export const isAiAvailable = () => client !== null;
