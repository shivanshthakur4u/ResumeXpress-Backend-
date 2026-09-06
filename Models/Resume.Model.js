import mongoose from "mongoose";

const ExperienceSchema = new mongoose.Schema({
  title: String,
  companyName: String,
  city: String,
  state: String,
  startDate: String,
  endDate: String,
  currentlyWorking: Boolean,
  workSummary: String,
});

const EducationSchema = new mongoose.Schema({
  universityName: String,
  startDate: String,
  endDate: String,
  degree: String,
  major: String,
  currentlyStudying: Boolean,
  description: String,
});

const SkillSchema = new mongoose.Schema({
  name: String,
  rating: Number,
});

const ResumeSchema = new mongoose.Schema(
  {
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    jobTitle: { type: String, default: "" },
    address: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    themeColor: { type: String, default: "" },
    summary: { type: String, default: "" },
    template: { type: String, default: "legacy" },
    paperSize: { type: String, default: "A4" },
    typography: { type: String, default: "sans" },
    fontSize: { type: Number, default: 11 },
    spacing: { type: Number, default: 1.4 },
    targetRole: String,
    targetIndustry: String,
    targetJob: { type: String, ref: "Job", default: null },
    status: { type: String, default: "draft" },
    sections: { type: [new mongoose.Schema({
      id: String, type: String, title: String, hidden: Boolean, content: String,
      entries: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    }, { _id: false })], default: undefined },
    experience: [ExperienceSchema],
    education: [EducationSchema],
    skills: [SkillSchema],

    // Ownership. userEmail stays the authoritative key because existing
    // documents are keyed on it; user is populated going forward.
    userEmail: { type: String, required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },

    title: { type: String, required: true },

    // Sharing is opt-in. Without this a resume id was enough for anyone to
    // read the owner's phone, address and work history.
    isPublic: { type: Boolean, default: false, index: true },
    publicSlug: { type: String, unique: true, sparse: true, index: true },
    publicViews: { type: Number, default: 0 },
  },
  { timestamps: true, optimisticConcurrency: true }
);

// Serves the dashboard list query (owner's resumes, newest first). createdAt
// only exists now that timestamps are enabled, so this sort previously no-opped.
ResumeSchema.index({ userEmail: 1, createdAt: -1 });
ResumeSchema.index({ userEmail: 1, updatedAt: -1 });

export const Resume = mongoose.model("Resume", ResumeSchema);
