import express from "express";
import {
  createResume,
  deleteResumeById,
  getAllResume,
  getResumeById,
  updateResume,
} from "../controller/resumeController.js";
import { authMiddleware } from "../middleware/Auth.js";

const router = express.Router();

router.post("/createResume", authMiddleware, createResume);
router.get("/getResumes", authMiddleware, getAllResume);
router.put("/updateResume/:id", authMiddleware, updateResume);
router.get("/getResumeById/:id", getResumeById);
router.delete("/deleteResumeById/:id",authMiddleware, deleteResumeById);
export default router;
