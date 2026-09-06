import express from "express";
import {
  generateExperienceBullets,
  generateSummaries,
} from "../controller/aiController.js";
import { authMiddleware } from "../middleware/Auth.js";
import { validate } from "../middleware/validate.js";
import { aiSchemas } from "../validation/schemas.js";
import { aiLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

// Authentication is required on every AI route. These calls spend money against
// the server's own API key, so they must never be open to anonymous callers.
router.post(
  "/summaries",
  authMiddleware,
  aiLimiter,
  validate(aiSchemas.summaries),
  generateSummaries
);

router.post(
  "/experience-bullets",
  authMiddleware,
  aiLimiter,
  validate(aiSchemas.experienceBullets),
  generateExperienceBullets
);

export default router;
