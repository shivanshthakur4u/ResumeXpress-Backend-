import mongoose from "mongoose";
const owned = { userEmail: { type: String, required: true, index: true } };
const model = (name, fields, indexes = []) => {
  const schema = new mongoose.Schema({ ...owned, ...fields }, { timestamps: true, optimisticConcurrency: true });
  schema.index({ userEmail: 1, createdAt: -1 });
  for (const index of indexes) schema.index(index);
  return mongoose.model(name, schema);
};
export const Job = model("Job", { title: String, company: String, description: String, url: String, analysis: mongoose.Schema.Types.Mixed });
export const AIAnalysis = model("AIAnalysis", { kind: String, inputHash: String, model: String, latency: Number, usage: mongoose.Schema.Types.Mixed, output: mongoose.Schema.Types.Mixed, resume: mongoose.Schema.Types.ObjectId, job: mongoose.Schema.Types.ObjectId }, [{ userEmail: 1, kind: 1, inputHash: 1 }, { userEmail: 1, resume: 1, kind: 1, createdAt: -1 }, { userEmail: 1, kind: 1, createdAt: -1 }]);
export const CoverLetter = model("CoverLetter", { title: String, content: String, style: String, resume: mongoose.Schema.Types.ObjectId, job: mongoose.Schema.Types.ObjectId });
export const InterviewSession = model("InterviewSession", { resume: mongoose.Schema.Types.ObjectId, job: mongoose.Schema.Types.ObjectId, questions: [String], answers: [{ answer: String, feedback: mongoose.Schema.Types.Mixed }], status: { type: String, default: "active" } });
export const Application = model("Application", { company: String, position: String, url: String, resume: mongoose.Schema.Types.ObjectId, coverLetter: mongoose.Schema.Types.ObjectId, dateApplied: String, status: String, notes: String, interviewDates: [String], timeline: [{ status: String, date: { type: Date, default: Date.now } }] }, [{ userEmail: 1, status: 1 }]);
export const AnalyticsEvent = model("AnalyticsEvent", { event: String, resource: mongoose.Schema.Types.ObjectId });
export const CoachMessage = model("CoachMessage", { role: String, content: String, resume: mongoose.Schema.Types.ObjectId });
