import { recordEvent } from "../services/analyticsService.js";
import QRCode from "qrcode";
import { env } from "../config/env.js";
import { Resume } from "../Models/Resume.Model.js";
import { ApiError } from "../utils/ApiError.js";
import { buildResumePdf, optimizeResumeLayout } from "../services/documentService.js";
import { analyzeResume } from "../services/authenticityService.js";
import { analyzeMachineView } from "../services/machineViewService.js";
import { z } from "zod";
import { objectId } from "../validation/schemas.js";
import * as service from "../services/resumeService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import express from "express";
import {
  createResume,
  deleteResumeById,
  getAllResume,
  getResumeById,
  setResumeVisibility,
  updateResume,
} from "../controller/resumeController.js";
import { authMiddleware, optionalAuth } from "../middleware/Auth.js";
import { validate } from "../middleware/validate.js";
import { resumeSchemas } from "../validation/schemas.js";
import { documentLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

router.post(
  "/createResume",
  authMiddleware,
  validate(resumeSchemas.create),
  createResume
);

router.get(
  "/getResumes",
  authMiddleware,
  validate(resumeSchemas.list),
  getAllResume
);

router.put(
  "/updateResume/:id",
  authMiddleware,
  validate(resumeSchemas.update),
  updateResume
);

// optionalAuth rather than authMiddleware: the owner reads their own resume
// here, and everyone else only succeeds once isPublic has been turned on.
router.get(
  "/getResumeById/:id",
  optionalAuth,
  validate(resumeSchemas.byId),
  getResumeById
);

router.patch(
  "/visibility/:id",
  authMiddleware,
  validate(resumeSchemas.visibility),
  setResumeVisibility
);

router.delete(
  "/deleteResumeById/:id",
  authMiddleware,
  validate(resumeSchemas.byId),
  deleteResumeById
);

const versionParams = z.object({ params: z.object({ id: objectId, versionId: objectId }) });
router.get("/:id/versions", authMiddleware, validate(z.object({ params: z.object({ id: objectId }), query: z.object({ page: z.coerce.number().int().min(1).default(1) }) })), asyncHandler(async (req, res) => {
  res.json({ success: true, ...await service.listVersions({ id: req.params.id, userEmail: req.user.email, page: req.validatedQuery.page }) });
}));
router.get("/:id/versions/:versionId", authMiddleware, validate(versionParams), asyncHandler(async (req, res) => {
  res.json({ success: true, version: await service.getVersion({ ...req.params, userEmail: req.user.email }) });
}));
router.post("/:id/versions/:versionId/restore", authMiddleware, validate(versionParams), asyncHandler(async (req, res) => {
  res.json({ success: true, resume: await service.restoreVersion({ ...req.params, userEmail: req.user.email }) });
}));
router.post("/:id/duplicate", authMiddleware, validate(resumeSchemas.byId), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, resume: await service.duplicateResume({ id: req.params.id, userEmail: req.user.email }) });
}));
router.get("/:id/pdf", optionalAuth, validate(resumeSchemas.byId), asyncHandler(async (req, res) => {
  const resume = await service.getViewableResume({ id: req.params.id, requesterEmail: req.user?.email });
  const { buffer } = await buildResumePdf(resume);
  await recordEvent(req.user?.email, "resume_downloaded", req.params.id);
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="resume.pdf"', "Cache-Control": "private, no-store" }).send(buffer);
}));
router.get("/:id/layout", authMiddleware, validate(resumeSchemas.byId), asyncHandler(async (req, res) => {
  const resume = await service.getOwnedResume({ id: req.params.id, userEmail: req.user.email });
  const { pages, warnings } = await buildResumePdf(resume);
  res.json({ success: true, pages, warnings });
}));
router.post("/:id/layout/optimize", authMiddleware, documentLimiter, validate(resumeSchemas.byId), asyncHandler(async (req, res) => {
  const resume = await service.getOwnedResume({ id: req.params.id, userEmail: req.user.email });
  res.json({ success: true, ...await optimizeResumeLayout(resume) });
}));
router.patch("/:id/slug", authMiddleware, validate(z.object({ params: z.object({ id: objectId }), body: z.object({ slug: z.string().trim().toLowerCase().min(3).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }) })), asyncHandler(async (req, res) => {
  const resume = await service.findOwnedResume(req.params.id, req.user.email);
  resume.publicSlug = req.body.slug; await resume.save();
  res.json({ success: true, slug: resume.publicSlug });
}));
router.get("/public/:slug", validate(z.object({ params: z.object({ slug: z.string().max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }) })), asyncHandler(async (req, res) => {
  const found = await Resume.findOne({ publicSlug: req.params.slug, isPublic: true }).select("_id");
  if (!found) throw ApiError.notFound("Public resume not found");
  const resume = await service.getViewableResume({ id: found._id });
  res.set("Cache-Control", "no-store").json({ success: true, id: found._id, resume });
}));
router.post("/public/:slug/view", validate(z.object({ params: z.object({ slug: z.string().max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }) })), asyncHandler(async (req, res) => {
  await Resume.updateOne({ publicSlug: req.params.slug, isPublic: true }, { $inc: { publicViews: 1 } });
  res.json({ success: true });
}));
// Deterministic, so no AI rate limit applies and it keeps working when the
// provider is unavailable.
router.get("/:id/authenticity", authMiddleware, validate(resumeSchemas.byId), asyncHandler(async (req, res) => {
  const resume = await service.getOwnedResume({ id: req.params.id, userEmail: req.user.email });
  res.json({ success: true, ...analyzeResume(resume) });
}));
router.get("/:id/machine-view", authMiddleware, documentLimiter, validate(resumeSchemas.byId), asyncHandler(async (req, res) => {
  const resume = await service.findOwnedResume(req.params.id, req.user.email);
  res.json({ success: true, ...await analyzeMachineView(resume) });
}));
router.get("/:id/qr", authMiddleware, validate(resumeSchemas.byId), asyncHandler(async (req, res) => {
  const resume = await service.findOwnedResume(req.params.id, req.user.email);
  if (!resume.isPublic) throw ApiError.badRequest("Make this resume public before creating a share code");
  const path = resume.publicSlug ? `/u/${resume.publicSlug}` : `/my-resume/${resume._id}/view`;
  const png = await QRCode.toBuffer(`${env.FRONTEND_URL}${path}`, { width: 256, margin: 2 });
  res.type("png").set("Cache-Control", "private, no-store").send(png);
}));
export default router;
