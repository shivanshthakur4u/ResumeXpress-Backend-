import express from "express";
import { authMiddleware } from "../middleware/Auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { evidenceSchemas } from "../validation/schemas.js";
import * as service from "../services/evidenceService.js";

const router = express.Router();
router.use(authMiddleware);

router.get("/", validate(evidenceSchemas.list), asyncHandler(async (req, res) => {
  res.json({ success: true, ...await service.listEvidence({ userEmail: req.user.email, resumeId: req.validatedQuery.resumeId }) });
}));

router.post("/", validate(evidenceSchemas.create), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, evidence: await service.createEvidence({ ...req.body, userId: req.user.id, userEmail: req.user.email }) });
}));

router.patch("/:id", validate(evidenceSchemas.update), asyncHandler(async (req, res) => {
  res.json({ success: true, evidence: await service.updateEvidence({ ...req.params, ...req.body, userEmail: req.user.email }) });
}));

router.delete("/:id", validate(evidenceSchemas.byId), asyncHandler(async (req, res) => {
  await service.deleteEvidence({ id: req.params.id, userEmail: req.user.email });
  res.json({ success: true });
}));

export default router;
