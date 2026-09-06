import mongoose from "mongoose";

// Experience, education and skills deliberately mirror the field names used by
// Resume, so copying between the two is a direct assignment rather than a
// mapping layer that has to be kept in sync.
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
  category: String,
});

const ProjectSchema = new mongoose.Schema({
  name: String,
  role: String,
  description: String,
  url: String,
  technologies: [String],
  startDate: String,
  endDate: String,
});

const CertificationSchema = new mongoose.Schema({
  name: String,
  issuer: String,
  issueDate: String,
  expiryDate: String,
  credentialId: String,
  url: String,
});

const AchievementSchema = new mongoose.Schema({
  title: String,
  description: String,
  date: String,
});

const AwardSchema = new mongoose.Schema({
  title: String,
  issuer: String,
  date: String,
  description: String,
});

const PublicationSchema = new mongoose.Schema({
  title: String,
  publisher: String,
  date: String,
  url: String,
  description: String,
});

const VolunteerSchema = new mongoose.Schema({
  organization: String,
  role: String,
  startDate: String,
  endDate: String,
  description: String,
});

const LanguageSchema = new mongoose.Schema({
  name: String,
  proficiency: String,
});

const CareerProfileSchema = new mongoose.Schema(
  {
    // One profile per user.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    userEmail: { type: String, required: true, index: true },

    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    jobTitle: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    address: { type: String, default: "" },
    website: { type: String, default: "" },
    linkedin: { type: String, default: "" },
    github: { type: String, default: "" },

    summary: { type: String, default: "" },

    experience: [ExperienceSchema],
    education: [EducationSchema],
    skills: [SkillSchema],
    projects: [ProjectSchema],
    certifications: [CertificationSchema],
    achievements: [AchievementSchema],
    awards: [AwardSchema],
    publications: [PublicationSchema],
    volunteer: [VolunteerSchema],
    languages: [LanguageSchema],
    interests: [String],

    preferences: {
      targetRoles: [String],
      targetIndustries: [String],
      employmentTypes: [String],
      locations: [String],
      remotePreference: { type: String, default: "" },
      salaryExpectation: { type: String, default: "" },
      noticePeriod: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

export const CareerProfile = mongoose.model(
  "CareerProfile",
  CareerProfileSchema
);
