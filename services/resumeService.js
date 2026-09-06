import { recordEvent } from "./analyticsService.js";
import { ResumeVersion } from "../Models/ResumeVersion.Model.js";
import { resumeWritableFields } from "../validation/schemas.js";
import sanitizeHtml from "sanitize-html";
import { Resume } from "../Models/Resume.Model.js";
import { User } from "../Models/User.Model.js";
import { Job, AIAnalysis } from "../Models/CareerWorkspace.Model.js";
import { ApiError } from "../utils/ApiError.js";

const SORT_OPTIONS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  title: { title: 1 },
  updated: { updatedAt: -1 },
  status: { status: 1, updatedAt: -1 },
};

// User input reaches a $regex, so metacharacters are escaped to keep it a
// literal substring match rather than an attacker-supplied pattern.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Never sent to a client.
const INTERNAL_FIELDS = ["userEmail", "user", "__v"];

const stripInternal = (doc) => {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  for (const f of INTERNAL_FIELDS) delete obj[f];
  if (obj.experience) obj.experience = obj.experience.map(item => ({ ...item, workSummary: sanitizeHtml(item.workSummary ?? "", { allowedTags: ["p", "br", "ul", "ol", "li", "strong", "b", "i", "em", "u", "a"], allowedAttributes: { a: ["href"] }, allowedSchemes: ["https", "http", "mailto"] }) }));
  return obj;
};

export const createResume = async ({ title, userEmail }) => {
  const duplicate = await Resume.findOne({ title, userEmail });
  if (duplicate) throw ApiError.conflict("A resume with this title already exists");

  const user = await User.findOne({ email: userEmail }).select("_id");
  if (!user) throw ApiError.notFound("User not found");

  const resume = await Resume.create({ title, userEmail, user: user._id });

  await User.updateOne({ _id: user._id }, { $push: { resumes: resume._id } });

  await recordEvent(userEmail, "resume_created", resume._id);
  return { title: resume.title, _id: resume._id };
};

export const listResumes = async ({ userEmail, page, limit, search, sort }) => {
  const filter = { userEmail };
  if (search) filter.title = { $regex: escapeRegex(search), $options: "i" };

  const [resumes, total] = await Promise.all([
    sort === "score" ? Resume.aggregate([
      { $match: filter },
      { $lookup: { from: AIAnalysis.collection.name, let: { resumeId: "$_id" }, pipeline: [
        { $match: { userEmail, kind: "ats", $expr: { $eq: ["$resume", "$$resumeId"] } } },
        { $sort: { createdAt: -1, _id: -1 } }, { $limit: 1 },
        { $project: { score: "$output.overallScore", createdAt: 1 } },
      ], as: "lastAts" } },
      { $set: { latestAtsScore: { $ifNull: [{ $first: "$lastAts.score" }, null] }, atsStale: { $gt: ["$updatedAt", { $first: "$lastAts.createdAt" }] } } },
      { $sort: { latestAtsScore: -1, updatedAt: -1, _id: -1 } },
      { $skip: (page - 1) * limit }, { $limit: limit }, { $project: { lastAts: 0 } },
    ]) : Resume.find(filter)
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
  await saveResumeContent(resume, data);

  return stripInternal(resume);
};

export const deleteResume = async ({ id, userEmail }) => {
  const resume = await findOwnedResume(id, userEmail);
  await Resume.deleteOne({ _id: resume._id });
  await ResumeVersion.deleteMany({ resume: resume._id, userEmail });
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
  if (!isOwner) {
    delete rest.publicViews;
    delete rest.targetRole; delete rest.targetIndustry; delete rest.targetJob; delete rest.status;
    if (rest.sections) {
      rest.sections = rest.sections.filter(section => !section.hidden);
      for (const type of ["summary", "experience", "education", "skills"]) {
        if (!rest.sections.some(section => section.type === type && section.content === undefined)) rest[type] = type === "summary" ? "" : [];
      }
    }
  }
  return { ...rest, ...(isOwner ? { _id, title } : {}), isOwner };
};

// Save the previous state before mutation; an interrupted save cannot lose it.
export const saveResumeContent = async (resume, data, source = "manual") => {
  const clean = resumeWritableFields.partial().parse(data);
  if (clean.targetJob && !await Job.exists({ _id: clean.targetJob, userEmail: resume.userEmail })) throw ApiError.notFound("Target job not found. Select an owned job or clear the target.");
  if (clean.experience) clean.experience = clean.experience.map(item => ({
    ...item, workSummary: sanitizeHtml(item.workSummary ?? "", {
      allowedTags: ["p", "br", "ul", "ol", "li", "strong", "b", "i", "em", "u", "a"],
      allowedAttributes: { a: ["href"] }, allowedSchemes: ["https", "http", "mailto"],
    }),
  }));
  const snapshot = resumeWritableFields.partial().parse(resume.toObject());
  await ResumeVersion.updateOne({ resume: resume._id, revision: resume.__v ?? 0 }, {
    $setOnInsert: { userEmail: resume.userEmail, snapshot, source, },
  }, { upsert: true });
  Object.assign(resume, clean);
  resume.increment();
  await resume.save();
  await recordEvent(resume.userEmail, data.status === "ready" ? "resume_completed" : "resume_updated", resume._id);
  return stripInternal(resume);
};

export const listVersions = async ({ id, userEmail, page = 1 }) => {
  await findOwnedResume(id, userEmail);
  const filter = { resume: id, userEmail };
  const [versions, total] = await Promise.all([
    ResumeVersion.find(filter).sort({ revision: -1 }).skip((page - 1) * 20).limit(20)
      .select("revision source createdAt").lean(),
    ResumeVersion.countDocuments(filter),
  ]);
  return { versions, total, page };
};

export const getVersion = async ({ id, versionId, userEmail }) => {
  await findOwnedResume(id, userEmail);
  const version = await ResumeVersion.findOne({ _id: versionId, resume: id, userEmail }).lean();
  if (!version) throw ApiError.notFound("Version not found");
  return { _id: version._id, revision: version.revision, source: version.source, createdAt: version.createdAt, snapshot: version.snapshot };
};

export const restoreVersion = async (args) => {
  const version = await getVersion(args);
  const resume = await findOwnedResume(args.id, args.userEmail);
  return saveResumeContent(resume, Object.fromEntries(Object.keys(resumeWritableFields.shape).map(key => [key, version.snapshot[key]])), "restore");
};

export const duplicateResume = async ({ id, userEmail }) => {
  const original = await findOwnedResume(id, userEmail);
  const title = `${original.title.slice(0, 65)} (copy ${Date.now()})`;
  const created = await createResume({ title, userEmail });
  const copy = await findOwnedResume(created._id, userEmail);
  return saveResumeContent(copy, { ...resumeWritableFields.partial().parse(original.toObject()), title });
};
