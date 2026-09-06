import mongoose from "mongoose";

const schema = new mongoose.Schema({
  resume: { type: mongoose.Schema.Types.ObjectId, ref: "Resume", required: true },
  userEmail: { type: String, required: true },
  revision: { type: Number, required: true },
  source: { type: String, enum: ["manual", "profile", "restore", "ai"], required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });
schema.index({ resume: 1, revision: 1 }, { unique: true });
schema.index({ userEmail: 1, resume: 1, createdAt: -1 });
export const ResumeVersion = mongoose.model("ResumeVersion", schema);
