import { Resume } from "../Models/Resume.Model.js";
import { User } from "../Models/User.Model.js";
import { ApiError } from "../utils/ApiError.js";

const SORT_OPTIONS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  title: { title: 1 },
  updated: { updatedAt: -1 },
};

// User input reaches a $regex, so metacharacters are escaped to keep it a
// literal substring match rather than an attacker-supplied pattern.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Never sent to a client.
const INTERNAL_FIELDS = ["userEmail", "user", "__v"];

const stripInternal = (doc) => {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  for (const f of INTERNAL_FIELDS) delete obj[f];
  return obj;
};

export const createResume = async ({ title, userEmail }) => {
  const duplicate = await Resume.findOne({ title, userEmail });
  if (duplicate) throw ApiError.conflict("A resume with this title already exists");

  const user = await User.findOne({ email: userEmail }).select("_id");
  if (!user) throw ApiError.notFound("User not found");

  const resume = await Resume.create({ title, userEmail, user: user._id });

  await User.updateOne({ _id: user._id }, { $push: { resumes: resume._id } });

  return { title: resume.title, _id: resume._id };
};

export const listResumes = async ({ userEmail, page, limit, search, sort }) => {
  const filter = { userEmail };
  if (search) filter.title = { $regex: escapeRegex(search), $options: "i" };

  const [resumes, total] = await Promise.all([
    Resume.find(filter)
      .sort(SORT_OPTIONS[sort] ?? SORT_OPTIONS.newest)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Resume.countDocuments(filter),
  ]);

  return {
    resumes,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    currentPage: page,
  };
};

export const findOwnedResume = async (id, userEmail) => {
  const resume = await Resume.findById(id);
  if (!resume) throw ApiError.notFound("Resume not found");
  // Ownership is checked separately from existence but reports the same error,
  // so this cannot be used to probe which resume ids exist.
  if (resume.userEmail !== userEmail) throw ApiError.notFound("Resume not found");
  return resume;
};

export const getOwnedResume = async ({ id, userEmail }) =>
  stripInternal(await findOwnedResume(id, userEmail));

export const updateResume = async ({ id, userEmail, data }) => {
  const resume = await findOwnedResume(id, userEmail);

  // `data` has already been through the zod schema, so it contains only
  // writable resume fields — userEmail and _id cannot arrive here.
  Object.assign(resume, data);
  await resume.save();

  return stripInternal(resume);
};

export const deleteResume = async ({ id, userEmail }) => {
  const resume = await findOwnedResume(id, userEmail);
  await Resume.deleteOne({ _id: resume._id });
  await User.updateOne({ email: userEmail }, { $pull: { resumes: resume._id } });
};

export const setResumeVisibility = async ({ id, userEmail, isPublic }) => {
  const resume = await findOwnedResume(id, userEmail);
  resume.isPublic = isPublic;
  await resume.save();
  return { _id: resume._id, isPublic: resume.isPublic };
};

// Serves the share link. The owner can always read their own resume; everyone
// else only sees it once the owner has explicitly made it public.
export const getViewableResume = async ({ id, requesterEmail }) => {
  const resume = await Resume.findById(id);
  if (!resume) throw ApiError.notFound("Resume not found");

  const isOwner = Boolean(requesterEmail && resume.userEmail === requesterEmail);
  if (!isOwner && !resume.isPublic) {
    throw ApiError.notFound("Resume not found");
  }

  const { _id, title, ...rest } = stripInternal(resume);
  // isOwner lets the client decide whether to offer the sharing controls
  // without having to expose who the owner actually is.
  return { ...rest, isOwner };
};
