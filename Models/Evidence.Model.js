import mongoose from "mongoose";

const evidenceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  userEmail: { type: String, required: true, index: true },
  claim: {
    resume: { type: mongoose.Schema.Types.ObjectId, ref: "Resume", default: null },
    path: { type: String, required: true, trim: true },
    text: { type: String, required: true, maxlength: 20000 },
  },
  kind: { type: String, enum: ["metric", "link", "document", "reference", "note"], required: true },
  value: { type: String, required: true, maxlength: 10000 },
  source: { type: String, default: "", maxlength: 2000 },
  confidence: { type: String, enum: ["confirmed", "estimated", "recalled"], required: true },
}, { timestamps: true, optimisticConcurrency: true });

evidenceSchema.index({ userEmail: 1, "claim.resume": 1 });

export const Evidence = mongoose.model("Evidence", evidenceSchema);
