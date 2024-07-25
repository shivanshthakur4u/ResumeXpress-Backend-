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
  description: String,
});

const SkillSchema = new mongoose.Schema({
  name: String,
  rating: Number,
});

const ResumeSchema = new mongoose.Schema({
  firstName: { type: String, default: "" },
  lastName: { type: String, default: "" },
  jobTitle: { type: String, default: "" },
  address: { type: String, default: "" },
  phone: { type: String, default: "" },
  email: { type: String, default: "" },
  themeColor: { type: String, default: "" },
  summary: { type: String, default: "" },
  experience: [ExperienceSchema],
  education: [EducationSchema],
  skills: [SkillSchema],
  userEmail: { type: String, required: true },
  title: { type: String, required: true },
});

export const Resume = mongoose.model("Resume", ResumeSchema);
