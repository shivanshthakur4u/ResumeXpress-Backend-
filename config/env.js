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
  AI_MODEL: z.string().default("gemini-1.5-flash"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  console.error(
    `\nInvalid environment configuration:\n${issues}\n\nSee .env.example for the required values.\n`
  );
  process.exit(1);
}

const raw = parsed.data;

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
