import express from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/Auth.js";
import { aiLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { objectId } from "../validation/schemas.js";
import * as schemas from "../validation/careerSchemas.js";
import * as service from "../services/careerWorkspaceService.js";
import { Job, CoverLetter, InterviewSession, Application, AIAnalysis, AnalyticsEvent, CoachMessage } from "../Models/CareerWorkspace.Model.js";
import { Resume } from "../Models/Resume.Model.js";
import { buildCoverLetterPdf } from "../services/documentService.js";
import { extractJobDocument } from "../services/jobDocumentService.js";
import { isAiAvailable } from "../services/ai/geminiProvider.js";
import { documentLimiter } from "../middleware/rateLimit.js";
const router = express.Router();
router.use(authMiddleware);
const byId = z.object({ params: z.object({ id: objectId }) });
const body = schema => z.object({ body: schema });
const respond = fn => asyncHandler(async (req, res) => res.json({ success: true, ...await fn(req) }));
router.get("/ai/status", respond(() => ({ enabled: isAiAvailable() })));
router.get("/overview", respond(req => service.overview(req.user.email)));
router.post(["/jobs/import", "/documents/import"], documentLimiter, validate(body(z.object({ filename: z.string().min(1).max(200), content: z.string().min(4).max(4200000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }))), respond(req => extractJobDocument(req.body)));
router.post("/jobs", validate(body(schemas.jobInput)), respond(async req => ({ job: await service.createJob(req.user.email, req.body) })));
router.post("/jobs/:id/analyze", aiLimiter, validate(byId), respond(async req => ({ job: await service.analyzeJob(req.user.email, req.params.id) })));
router.post("/ats", validate(body(schemas.contextInput)), respond(async req => ({ analysis: await service.ats(req.user.email, req.body) })));
router.post("/generate/:kind", aiLimiter, validate(z.object({ params: z.object({ kind: z.enum(["resume", "match", "optimizer", "bullets", "summary", "skills", "linkedin", "gap", "coach"]) }), body: schemas.contextInput })), respond(async req => ({ analysis: await service.generate(req.user.email, req.params.kind, req.body) })));
router.post("/analyses/:id/apply", validate(z.object({ params: z.object({ id: objectId }), body: z.object({ index: z.number().int().min(0).max(14), edited: z.string().min(1).max(20000).optional(), confirmed: z.literal(true) }) })), respond(async req => ({ resume: await service.applySuggestion(req.user.email, req.params.id, req.body.index, req.body.edited) })));
router.post("/analyses/:id/apply-draft", validate(z.object({ params: z.object({ id: objectId }), body: z.object({ confirmed: z.literal(true), fields: z.array(z.enum(Object.keys(schemas.resumeDraftFields.shape))).min(1).max(11), edited: schemas.resumeDraftFields.strict().optional() }) })), respond(async req => ({ resume: await service.applyResumeDraft(req.user.email, req.params.id, req.body.fields, req.body.edited) })));
router.post("/cover-letters", aiLimiter, validate(body(schemas.contextInput)), respond(async req => ({ letter: await service.createLetter(req.user.email, req.body) })));
router.get("/cover-letters/:id/pdf", validate(z.object({ params: z.object({ id: objectId }), query: z.object({ paperSize: z.enum(["A4", "Letter"]).default("A4") }) })), asyncHandler(async (req, res) => {
  const letter = await service.own(CoverLetter, req.params.id, req.user.email);
  const buffer = await buildCoverLetterPdf(letter, req.validatedQuery.paperSize);
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="cover-letter.pdf"', "Cache-Control": "private, no-store" }).send(buffer);
}));
router.put("/cover-letters/:id", validate(z.object({ params: z.object({ id: objectId }), body: z.object({ title: z.string().min(1).max(300), content: z.string().min(1).max(20000) }) })), respond(async req => {
  const letter = await service.own(CoverLetter, req.params.id, req.user.email); Object.assign(letter, req.body); await letter.save(); return { letter: service.publicFields(letter) };
}));
router.post("/interviews", aiLimiter, validate(body(schemas.contextInput)), respond(async req => ({ session: await service.startInterview(req.user.email, req.body) })));
router.post("/interviews/:id/answer", aiLimiter, validate(z.object({ params: z.object({ id: objectId }), body: z.object({ answer: z.string().trim().min(1).max(10000) }) })), respond(async req => ({ session: await service.answerInterview(req.user.email, req.params.id, req.body.answer) })));
router.post("/applications", validate(body(schemas.applicationInput)), respond(async req => ({ application: await service.saveApplication(req.user.email, req.body) })));
router.put("/applications/:id", validate(z.object({ params: z.object({ id: objectId }), body: schemas.applicationInput })), respond(async req => ({ application: await service.saveApplication(req.user.email, req.body, req.params.id) })));
router.get("/applications/insights", respond(req => service.outcomeInsights(req.user.email)));
for (const [path, model] of [["jobs", Job], ["applications", Application], ["cover-letters", CoverLetter], ["interviews", InterviewSession], ["analyses", AIAnalysis]]) {
  router.get(`/${path}`, validate(schemas.listInput), respond(req => service.list(model, req.user.email, req.validatedQuery)));
  router.get(`/${path}/:id`, validate(byId), respond(async req => ({ item: service.publicFields(await service.own(model, req.params.id, req.user.email)) })));
  router.delete(`/${path}/:id`, validate(byId), respond(async req => { const item = await service.own(model, req.params.id, req.user.email); await item.deleteOne(); return {}; }));
}
router.get("/coach/:id", validate(byId), respond(async req => {
  await service.own(Resume, req.params.id, req.user.email);
  return { messages: (await CoachMessage.find({ userEmail: req.user.email, resume: req.params.id }).sort({ createdAt: -1 }).limit(40).lean()).reverse().map(service.publicFields) };
}));
export default router;
