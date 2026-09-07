import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoSanitize from "express-mongo-sanitize";

import { configIssues, env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { generalLimiter } from "./middleware/rateLimit.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { ApiError } from "./utils/ApiError.js";

import careerWorkspaceRoutes from "./routes/careerWorkspaceRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import resumeRoutes from "./routes/resumeRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import careerProfileRoutes from "./routes/careerProfileRoutes.js";

const app = express();

// Rate limiting keys on client IP, which behind Vercel's proxy is only correct
// once the forwarded header is trusted.
app.set("trust proxy", 1);

app.use(helmet());

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin and non-browser clients (curl, health checks) send no Origin.
      if (!origin) return callback(null, true);
      if (env.corsOrigins.includes(origin)) return callback(null, true);
      callback(ApiError.forbidden(`Origin ${origin} is not allowed`));
    },
    credentials: true,
  })
);

// Bounded so a large body cannot be used to exhaust memory.
app.use(express.json({ limit: "5mb" }));

// Strips $-prefixed and dotted keys, which would otherwise let a crafted body
// smuggle query operators into a Mongo filter.
app.use(mongoSanitize());

app.use(generalLimiter);
// Temporary diagnostics requested by the repository workflow. Contains no resume data or tokens.
if (process.env.DEBUG_RESUMEXPRESS === "1") app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => console.info("[DEBUG-RESUMEXPRESS]", { method: req.method, status: res.statusCode, durationMs: Date.now() - started }));
  next();
});

// Deliberately mounted before the database gate: a liveness probe that fails
// when Mongo is down cannot tell you the process is up.
app.get("/health", (req, res) => {
  res.status(configIssues.length ? 503 : 200).json({ status: configIssues.length ? "misconfigured" : "ok", uptime: process.uptime(), ...(configIssues.length ? { configuration: configIssues } : {}) });
});

app.get("/", (req, res) => {
  res.status(200).json({ name: "ResumeXpress API", version: "v1" });
});

// Connections are established lazily and cached, so warm serverless
// invocations reuse the existing pool. Scoped to /api so only routes that
// actually touch the database depend on it.
app.use("/api", async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("Database connection failed:", err);
    next(ApiError.serviceUnavailable("Database is unavailable"));
  }
});

const mountRoutes = (prefix) => {
  app.use(`${prefix}/career`, careerWorkspaceRoutes);
  app.use(`${prefix}/user`, userRoutes);
  app.use(`${prefix}/resume`, resumeRoutes);
  app.use(`${prefix}/ai`, aiRoutes);
  app.use(`${prefix}/career-profile`, careerProfileRoutes);
};

// Versioned path for new clients; the unversioned path is kept so the existing
// frontend keeps working unchanged.
mountRoutes("/api/v1");
mountRoutes("/api");

app.use(notFoundHandler);
app.use(errorHandler);

// Vercel invokes the exported handler directly; listening is only for local
// and self-hosted runs. The previous app.listen() passed no port at all, so
// the server never bound one locally.
if (!process.env.VERCEL && env.NODE_ENV !== "test") {
  app.listen(env.PORT, () => {
    console.log(`ResumeXpress API listening on http://localhost:${env.PORT}`);
  });
}

export default app;
