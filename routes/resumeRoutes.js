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

export default router;
