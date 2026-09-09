import { Evidence } from "../Models/Evidence.Model.js";
import { User } from "../Models/User.Model.js";
import { findOwnedResume } from "./resumeService.js";
import { recordEvent } from "./analyticsService.js";
import { plainText } from "./atsService.js";
import { ApiError } from "../utils/ApiError.js";

const clean = (value) => plainText(String(value ?? "")).replace(/\s+/g, " ").trim();
const stripIds = (value) => {
  if (Array.isArray(value)) return value.map(stripIds);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["_id", "__v"].includes(key)).map(([key, item]) => [key, stripIds(item)]));
  return value;
};
const claimTextFor = (value) => typeof value === "string" ? clean(value) : JSON.stringify(stripIds(value ?? null));
const valueAtPath = (resume, path) => path.split(".").reduce((value, segment) => value == null ? undefined : value[segment], resume);

const publicEvidence = (doc, resume) => {
  const item = doc.toObject ? doc.toObject() : doc;
  const current = resume ? valueAtPath(resume, item.claim.path) : undefined;
  const currentText = resume && current !== undefined ? claimTextFor(current) : null;
  return {
    _id: item._id,
    claim: item.claim,
    kind: item.kind,
    value: item.value,
    source: item.source,
    confidence: item.confidence,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    stale: Boolean(resume && (current === undefined || currentText !== item.claim.text)),
    currentText,
  };
};

const owned = async (id, userEmail) => {
  const item = await Evidence.findOne({ _id: id, userEmail });
  if (!item) throw ApiError.notFound("Evidence not found");
  return item;
};

const ownerId = async (userId, userEmail) => {
  if (userId) return userId;
  const user = await User.findOne({ email: userEmail }).select("_id");
  if (!user) throw ApiError.notFound("User not found");
  return user._id;
};

export const listEvidence = async ({ userEmail, resumeId }) => {
  const resume = resumeId ? await findOwnedResume(resumeId, userEmail) : null;
  const items = await Evidence.find({ userEmail, ...(resumeId ? { "claim.resume": resume._id } : {}) }).sort({ createdAt: -1, _id: -1 }).lean();
  const grouped = new Map();
  for (const item of items) {
    const path = item.claim.path;
    if (!grouped.has(path)) grouped.set(path, []);
    grouped.get(path).push(publicEvidence(item, resume));
  }
  const groups = [...grouped.entries()].map(([path, evidence]) => ({ path, evidence }));
  return { groups, total: items.length };
};

export const createEvidence = async ({ userId, userEmail, resumeId = null, path, text, kind, value, source = "", confidence }) => {
  const resume = resumeId ? await findOwnedResume(resumeId, userEmail) : null;
  const evidence = await Evidence.create({
    user: await ownerId(userId, userEmail),
    userEmail,
    claim: { resume: resume?._id ?? null, path, text: claimTextFor(text) },
    kind,
    value: clean(value),
    source: clean(source),
    confidence,
  });
  await recordEvent(userEmail, "evidence_attached", evidence._id);
  return publicEvidence(evidence, resume);
};

export const updateEvidence = async ({ id, userEmail, value, source, confidence }) => {
  const evidence = await owned(id, userEmail);
  if (value !== undefined) evidence.value = clean(value);
  if (source !== undefined) evidence.source = clean(source);
  if (confidence !== undefined) evidence.confidence = confidence;
  await evidence.save();
  const resume = evidence.claim.resume ? await findOwnedResume(evidence.claim.resume, userEmail) : null;
  return publicEvidence(evidence, resume);
};

export const deleteEvidence = async ({ id, userEmail }) => {
  const evidence = await owned(id, userEmail);
  await evidence.deleteOne();
};

export const createEvidenceRows = async ({ userId, userEmail, resumeId, path, text, quotes, source = "AI suggestion evidence", confidence = "recalled" }) => {
  const values = [...new Set((quotes ?? []).map(clean).filter(Boolean))].slice(0, 20);
  if (!values.length) return [];
  const user = await ownerId(userId, userEmail);
  const docs = await Evidence.insertMany(values.map(value => ({ user, userEmail, claim: { resume: resumeId, path, text: claimTextFor(text) }, kind: "note", value, source, confidence })));
  await Promise.all(docs.map(doc => recordEvent(userEmail, "evidence_attached", doc._id)));
  return docs;
};
