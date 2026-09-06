import { CareerProfile } from "../Models/CareerProfile.Model.js";
import { User } from "../Models/User.Model.js";
import { ApiError } from "../utils/ApiError.js";
import { findOwnedResume, saveResumeContent } from "./resumeService.js";

const stripInternal = (doc) => {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.user;
  delete obj.userEmail;
  delete obj.__v;
  return obj;
};

// Weighted so the score reflects what actually makes a resume usable: an empty
// profile with a filled-in interests list should not read as half complete.
const COMPLETENESS_SECTIONS = [
  {
    key: "personal",
    label: "Personal details",
    weight: 20,
    isComplete: (p) =>
      Boolean(p.firstName && p.lastName && p.jobTitle && p.email),
  },
  {
    key: "summary",
    label: "Professional summary",
    weight: 15,
    isComplete: (p) => Boolean(p.summary && p.summary.trim().length >= 40),
  },
  {
    key: "experience",
    label: "Work experience",
    weight: 25,
    isComplete: (p) => (p.experience?.length ?? 0) > 0,
  },
  {
    key: "education",
    label: "Education",
    weight: 15,
    isComplete: (p) => (p.education?.length ?? 0) > 0,
  },
  {
    key: "skills",
    label: "Skills",
    weight: 15,
    isComplete: (p) => (p.skills?.length ?? 0) >= 3,
  },
  {
    key: "supporting",
    label: "Projects, certifications or awards",
    weight: 10,
    isComplete: (p) =>
      (p.projects?.length ?? 0) +
        (p.certifications?.length ?? 0) +
        (p.awards?.length ?? 0) +
        (p.publications?.length ?? 0) >
      0,
  },
];

export const computeCompleteness = (profile) => {
  const sections = COMPLETENESS_SECTIONS.map(
    ({ key, label, weight, isComplete }) => ({
      key,
      label,
      weight,
      complete: isComplete(profile),
    })
  );

  const score = sections.reduce(
    (total, s) => total + (s.complete ? s.weight : 0),
    0
  );

  return {
    score,
    sections,
    missing: sections.filter((s) => !s.complete).map((s) => s.label),
  };
};

// Read-or-create: the rest of the app can assume a profile always exists, so
// no caller has to handle a null profile.
export const getOrCreateProfile = async ({ userEmail }) => {
  const existing = await CareerProfile.findOne({ userEmail });
  if (existing) return existing;

  const user = await User.findOne({ email: userEmail }).select("_id name email");
  if (!user) throw ApiError.notFound("User not found");

  // Seeded from the account so a brand new profile is not entirely blank.
  const [firstName = "", ...rest] = (user.name ?? "").trim().split(/\s+/);

  return CareerProfile.create({
    user: user._id,
    userEmail: user.email,
    firstName,
    lastName: rest.join(" "),
    email: user.email,
  });
};

export const getProfile = async ({ userEmail }) => {
  const profile = await getOrCreateProfile({ userEmail });
  return {
    profile: stripInternal(profile),
    completeness: computeCompleteness(profile),
  };
};

export const updateProfile = async ({ userEmail, data }) => {
  const profile = await getOrCreateProfile({ userEmail });

  // `data` is already zod-validated, so it holds only writable profile fields.
  // preferences is merged rather than replaced so a partial update does not
  // wipe the sibling preference keys.
  const { preferences, ...rest } = data;
  Object.assign(profile, rest);
  if (preferences) {
    profile.preferences = { ...profile.preferences?.toObject?.(), ...preferences };
  }

  await profile.save();

  return {
    profile: stripInternal(profile),
    completeness: computeCompleteness(profile),
  };
};

// Copies profile content into a resume. Only sections the resume can render
// are handled; see IMPORTABLE_SECTIONS in validation/schemas.js.
export const importProfileIntoResume = async ({
  resumeId,
  userEmail,
  sections,
}) => {
  const [profile, resume] = await Promise.all([
    getOrCreateProfile({ userEmail }),
    findOwnedResume(resumeId, userEmail),
  ]);

  const original = resume.toObject();
  const applied = [];

  if (sections.includes("personal")) {
    resume.firstName = profile.firstName ?? "";
    resume.lastName = profile.lastName ?? "";
    resume.jobTitle = profile.jobTitle ?? "";
    resume.email = profile.email ?? "";
    resume.phone = profile.phone ?? "";
    resume.address = profile.address ?? "";
    applied.push("personal");
  }

  if (sections.includes("summary")) {
    resume.summary = profile.summary ?? "";
    applied.push("summary");
  }

  if (sections.includes("experience")) {
    resume.experience = (profile.experience ?? []).map((e) => ({
      title: e.title,
      companyName: e.companyName,
      city: e.city,
      state: e.state,
      startDate: e.startDate,
      endDate: e.endDate,
      currentlyWorking: e.currentlyWorking,
      workSummary: e.workSummary,
    }));
    applied.push("experience");
  }

  if (sections.includes("education")) {
    resume.education = (profile.education ?? []).map((e) => ({
      universityName: e.universityName,
      degree: e.degree,
      major: e.major,
      startDate: e.startDate,
      endDate: e.endDate,
      currentlyStudying: e.currentlyStudying,
      description: e.description,
    }));
    applied.push("education");
  }

  if (sections.includes("skills")) {
    // The resume's skill shape has no category, so it is dropped here rather
    // than silently persisted to a field that does not exist.
    resume.skills = (profile.skills ?? []).map((s) => ({
      name: s.name,
      rating: s.rating,
    }));
    applied.push("skills");
  }

  const core = ["summary", "experience", "education", "skills"];
  const defaults = core.map(type => ({ id: type, type, title: type[0].toUpperCase() + type.slice(1), hidden: false }));
  let layout = resume.sections?.map(section => section.toObject()) ?? defaults;
  let added = false;
  for (const type of sections.filter(type => !["personal", ...core].includes(type))) {
    const savedSections = profile.sections?.filter(section => section.type === type) ?? [];
    const items = profile[type] ?? [];
    const content = items.map(item => typeof item === "string" ? item : Object.entries(item.toObject ? item.toObject() : item).filter(([key, value]) => key !== "_id" && value !== undefined && value !== "" && (!Array.isArray(value) || value.length)).map(([key, value]) => `${key.replace(/([A-Z])/g, " $1")}: ${Array.isArray(value) ? value.join(", ") : value}`).join("\n")).join("\n\n");
    if (savedSections.length || content) {
      layout = layout.filter(section => section.type !== type);
      layout.push(...(savedSections.length ? savedSections.map(section => section.toObject()) : [{ id: `profile-${type}`, type, title: type[0].toUpperCase() + type.slice(1), hidden: false, content }]));
      applied.push(type); added = true;
    }
  }
  if (added) resume.sections = layout;
  const next = resume.toObject();
  Object.assign(resume, original);
  await saveResumeContent(resume, next, "profile");

  return { applied };
};

// Writes a resume's content back to the master profile. Empty values are
// skipped so syncing a sparse resume cannot blank out richer profile data.
export const syncProfileFromResume = async ({ resumeId, userEmail }) => {
  const [profile, resume] = await Promise.all([
    getOrCreateProfile({ userEmail }),
    findOwnedResume(resumeId, userEmail),
  ]);

  const updated = [];

  for (const field of [
    "firstName",
    "lastName",
    "jobTitle",
    "email",
    "phone",
    "address",
    "summary",
  ]) {
    if (resume[field]) {
      profile[field] = resume[field];
      updated.push(field);
    }
  }

  for (const field of ["experience", "education", "skills"]) {
    if (resume[field]?.length) {
      profile[field] = resume[field].map((item) => {
        // Subdocument _ids belong to the resume; carrying them into the
        // profile's own arrays would reuse ids across two collections.
        const { _id, ...rest } = item.toObject?.() ?? item;
        return rest;
      });
      updated.push(field);
    }
  }

  if (resume.sections?.length) { profile.sections = resume.sections.map(section => section.toObject()); updated.push("sections"); }
  await profile.save();

  return {
    updated,
    completeness: computeCompleteness(profile),
  };
};
