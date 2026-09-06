import { asyncHandler } from "../utils/asyncHandler.js";
import * as careerProfileService from "../services/careerProfileService.js";

export const getCareerProfile = asyncHandler(async (req, res) => {
  const { profile, completeness } = await careerProfileService.getProfile({
    userEmail: req.user.email,
  });

  res.status(200).json({
    success: true,
    profile,
    completeness,
    message: "Career profile fetched successfully",
  });
});

export const updateCareerProfile = asyncHandler(async (req, res) => {
  const { profile, completeness } = await careerProfileService.updateProfile({
    userEmail: req.user.email,
    data: req.body,
  });

  res.status(200).json({
    success: true,
    profile,
    completeness,
    message: "Career profile updated successfully",
  });
});

export const importToResume = asyncHandler(async (req, res) => {
  const { applied } = await careerProfileService.importProfileIntoResume({
    resumeId: req.params.id,
    userEmail: req.user.email,
    sections: req.body.sections,
  });

  res.status(200).json({
    success: true,
    applied,
    message: `Imported ${applied.length} section${
      applied.length === 1 ? "" : "s"
    } from your career profile`,
  });
});

export const syncFromResume = asyncHandler(async (req, res) => {
  const { updated, completeness } =
    await careerProfileService.syncProfileFromResume({
      resumeId: req.params.id,
      userEmail: req.user.email,
    });

  res.status(200).json({
    success: true,
    updated,
    completeness,
    message: "Career profile updated from this resume",
  });
});
