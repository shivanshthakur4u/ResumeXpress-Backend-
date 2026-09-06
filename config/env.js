import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(5000),

  DB_URI: z.string().min(1, "DB_URI is required"),

  // A short secret makes JWT forgery meaningfully easier, so this is enforced
  // rather than documented.
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters (use: openssl rand -hex 32)"),
  JWT_EXPIRES_IN: z.string().default("48h"),

  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  // Comma-separated allowlist. Falls back to FRONTEND_URL when unset.
  CORS_ORIGINS: z.string().optional(),

  EMAIL_USER: z.string().email().optional(),
  EMAIL_APP_PASSWORD: z.string().optional(),
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().positive().default(587),

  GOOGLE_AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("gemini-3.6-flash"),
});

const environment = { ...process.env };
for (const key of ["EMAIL_USER", "EMAIL_APP_PASSWORD", "GOOGLE_AI_API_KEY", "CORS_ORIGINS"]) if (!environment[key]?.trim()) delete environment[key];
const parsed = envSchema.safeParse(environment);
export const configIssues = parsed.success
  ? []
  : parsed.error.issues.map(issue => ({ field: issue.path.join(".") || "(root)", message: issue.message }));

// Keep the server alive when deployment configuration is incomplete so the
// liveness endpoint can report the exact missing fields instead of Vercel's
// opaque FUNCTION_INVOCATION_FAILED page. Database and auth routes still fail
// closed until the required values are supplied.
const raw = parsed.success ? parsed.data : {
  NODE_ENV: environment.NODE_ENV ?? "production",
  PORT: Number(environment.PORT ?? 5000),
  DB_URI: environment.DB_URI ?? "",
  JWT_SECRET: environment.JWT_SECRET ?? "",
  JWT_EXPIRES_IN: environment.JWT_EXPIRES_IN ?? "48h",
  FRONTEND_URL: environment.FRONTEND_URL ?? "http://localhost:3000",
  CORS_ORIGINS: environment.CORS_ORIGINS,
  EMAIL_USER: environment.EMAIL_USER,
  EMAIL_APP_PASSWORD: environment.EMAIL_APP_PASSWORD,
  SMTP_HOST: environment.SMTP_HOST ?? "smtp.gmail.com",
  SMTP_PORT: Number(environment.SMTP_PORT ?? 587),
  GOOGLE_AI_API_KEY: environment.GOOGLE_AI_API_KEY,
  AI_MODEL: environment.AI_MODEL ?? "gemini-3.6-flash",
};

if (configIssues.length) console.error("Invalid environment configuration", configIssues);

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === "production",
  corsOrigins: (raw.CORS_ORIGINS ?? raw.FRONTEND_URL)
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  emailEnabled: Boolean(raw.EMAIL_USER && raw.EMAIL_APP_PASSWORD),
  aiEnabled: Boolean(raw.GOOGLE_AI_API_KEY),
};
