import express from "express";
import {
  getCareerProfile,
  importToResume,
  syncFromResume,
  updateCareerProfile,
} from "../controller/careerProfileController.js";
import { authMiddleware } from "../middleware/Auth.js";
import { validate } from "../middleware/validate.js";
import { careerProfileSchemas } from "../validation/schemas.js";

const router = express.Router();

// A career profile is always private to its owner — there is no public view.
router.use(authMiddleware);

router.get("/", getCareerProfile);

router.put("/", validate(careerProfileSchemas.update), updateCareerProfile);

router.post(
  "/import-to-resume/:id",
  validate(careerProfileSchemas.importToResume),
  importToResume
);

router.post(
  "/sync-from-resume/:id",
  validate(careerProfileSchemas.syncFromResume),
  syncFromResume
);

export default router;
