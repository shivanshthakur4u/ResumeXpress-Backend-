import { asyncHandler } from "../utils/asyncHandler.js";
import * as aiService from "../services/aiService.js";

export const generateSummaries = asyncHandler(async (req, res) => {
  const summaries = await aiService.generateSummaries({
    jobTitle: req.body.jobTitle,
    facts: req.body.facts,
  });

  res.status(200).json({
    success: true,
    summaries,
    message: "Summaries generated successfully",
  });
});

export const generateExperienceBullets = asyncHandler(async (req, res) => {
  const content = await aiService.generateExperienceBullets({
    positionTitle: req.body.positionTitle,
    facts: req.body.facts,
  });

  res.status(200).json({
    success: true,
    content,
    message: "Experience bullets generated successfully",
  });
});
