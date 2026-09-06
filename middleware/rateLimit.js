import rateLimit from "express-rate-limit";
import { ApiError } from "../utils/ApiError.js";
import { env } from "../config/env.js";

const build = ({ windowMs, limit, message }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    // Otherwise a test suite that exercises sign-in several times trips the
    // brute-force ceiling and starts asserting against 429s.
    skip: () => env.NODE_ENV === "test",
    handler: (req, res, next) => next(ApiError.tooManyRequests(message)),
  });

export const generalLimiter = build({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  message: "Too many requests. Please try again shortly.",
});

// Brute-force protection for credential endpoints.
export const authLimiter = build({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: "Too many attempts. Please try again in 15 minutes.",
});

// Password reset also sends mail, so a low ceiling doubles as abuse protection
// against using the endpoint to spam a third party's inbox.
export const passwordResetLimiter = build({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  message: "Too many password reset requests. Please try again in an hour.",
});

// AI calls cost money per request, so this ceiling is a spend control.
export const aiLimiter = build({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  message: "AI request limit reached. Please try again later.",
});

export const documentLimiter = build({
  windowMs: 60 * 1000,
  limit: 10,
  message: "Too many document requests. Please try again in a minute.",
});
