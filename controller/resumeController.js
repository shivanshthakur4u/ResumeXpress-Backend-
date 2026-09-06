import { asyncHandler } from "../utils/asyncHandler.js";
import * as resumeService from "../services/resumeService.js";

export const createResume = asyncHandler(async (req, res) => {
  const resume = await resumeService.createResume({
    title: req.body.title,
    userEmail: req.user.email,
  });
  res.status(201).json(resume);
});

export const getAllResume = asyncHandler(async (req, res) => {
  const { page, limit, search, sort } = req.validatedQuery;
  const result = await resumeService.listResumes({
    userEmail: req.user.email,
    page,
    limit,
    search,
    sort,
  });

  res.status(200).json({
    success: true,
    resumes: result.resumes,
    total: result.total,
    totalPages: result.totalPages,
    currentPage: result.currentPage,
    message: "Resumes fetched successfully",
  });
});

export const updateResume = asyncHandler(async (req, res) => {
  const updatedResume = await resumeService.updateResume({
    id: req.params.id,
    userEmail: req.user.email,
    data: req.body,
  });

  res.status(200).json({
    success: true,
    updatedResume,
    message: "Resume updated successfully",
  });
});

// Serves both the owner's editor and the public share link. optionalAuth
// populates req.user when a valid token is present.
export const getResumeById = asyncHandler(async (req, res) => {
  const resume = await resumeService.getViewableResume({
    id: req.params.id,
    requesterEmail: req.user?.email,
  });

  res.status(200).json({
    success: true,
    resume,
    message: "Resume fetched successfully",
  });
});

export const deleteResumeById = asyncHandler(async (req, res) => {
  await resumeService.deleteResume({
    id: req.params.id,
    userEmail: req.user.email,
  });

  res.status(200).json({
    success: true,
    message: "Resume deleted successfully",
  });
});

export const setResumeVisibility = asyncHandler(async (req, res) => {
  const result = await resumeService.setResumeVisibility({
    id: req.params.id,
    userEmail: req.user.email,
    isPublic: req.body.isPublic,
  });

  res.status(200).json({
    success: true,
    ...result,
    message: result.isPublic
      ? "Resume is now publicly shareable"
      : "Resume is now private",
  });
});
