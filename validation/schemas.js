import { z } from "zod";

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address");

// Strength is enforced when a password is being *set*, never on sign-in —
// otherwise users with older passwords would be locked out of their accounts.
const strongPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .regex(/[a-zA-Z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

export const authSchemas = {
  register: z.object({
    body: z.object({
      name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
      email,
      password: strongPassword,
    }),
  }),

  signin: z.object({
    body: z.object({
      email,
      password: z.string().min(1, "Password is required"),
    }),
  }),

  forgotPassword: z.object({
    body: z.object({ email }),
  }),

  resetPassword: z.object({
    body: z.object({
      token: z.string().min(1, "Reset token is required"),
      newPassword: strongPassword,
    }),
  }),
};

const experienceItem = z.object({
  title: z.string().max(200).optional(),
  companyName: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  startDate: z.string().max(50).optional(),
  endDate: z.string().max(50).optional(),
  currentlyWorking: z.boolean().optional(),
  workSummary: z.string().max(10000).optional(),
});

const educationItem = z.object({
  universityName: z.string().max(200).optional(),
  startDate: z.string().max(50).optional(),
  endDate: z.string().max(50).optional(),
  degree: z.string().max(200).optional(),
  major: z.string().max(200).optional(),
  currentlyStudying: z.boolean().optional(),
  description: z.string().max(10000).optional(),
});

const skillItem = z.object({
  name: z.string().max(100).optional(),
  rating: z.number().min(0).max(5).optional(),
});

const projectItem = z.object({
  name: z.string().max(200).optional(),
  role: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  url: z.string().max(500).optional(),
  technologies: z.array(z.string().max(100)).max(50).optional(),
  startDate: z.string().max(50).optional(),
  endDate: z.string().max(50).optional(),
});

const certificationItem = z.object({
  name: z.string().max(200).optional(),
  issuer: z.string().max(200).optional(),
  issueDate: z.string().max(50).optional(),
  expiryDate: z.string().max(50).optional(),
  credentialId: z.string().max(200).optional(),
  url: z.string().max(500).optional(),
});

const achievementItem = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  date: z.string().max(50).optional(),
});

const awardItem = z.object({
  title: z.string().max(200).optional(),
  issuer: z.string().max(200).optional(),
  date: z.string().max(50).optional(),
  description: z.string().max(5000).optional(),
});

const publicationItem = z.object({
  title: z.string().max(300).optional(),
  publisher: z.string().max(200).optional(),
  date: z.string().max(50).optional(),
  url: z.string().max(500).optional(),
  description: z.string().max(5000).optional(),
});

const volunteerItem = z.object({
  organization: z.string().max(200).optional(),
  role: z.string().max(200).optional(),
  startDate: z.string().max(50).optional(),
  endDate: z.string().max(50).optional(),
  description: z.string().max(5000).optional(),
});

const languageItem = z.object({
  name: z.string().max(100).optional(),
  proficiency: z.string().max(50).optional(),
});

export const supportingSchemas = { projects: projectItem, certifications: certificationItem, achievements: achievementItem, awards: awardItem, publications: publicationItem, volunteer: volunteerItem, languages: languageItem };

// Every writable resume field is listed explicitly. Anything absent here —
// notably `userEmail` and `_id` — is stripped by zod before it reaches the
// document, which is what stops a client reassigning a resume to another user.
export const resumeWritableFields = z.object({
  title: z.string().trim().min(1).max(100),
  firstName: z.string().max(100),
  lastName: z.string().max(100),
  jobTitle: z.string().max(200),
  address: z.string().max(300),
  phone: z.string().max(50),
  email: z.string().max(200),
  themeColor: z.string().max(50),
  summary: z.string().max(20000),
  experience: z.array(experienceItem).max(50),
  education: z.array(educationItem).max(50),
  skills: z.array(skillItem).max(100),
  template: z.enum(["legacy", "ats-minimal", "professional", "modern", "executive", "technical", "academic"]),
  paperSize: z.enum(["A4", "Letter"]),
  typography: z.enum(["sans", "serif", "mono"]),
  fontSize: z.number().min(9).max(14),
  spacing: z.number().min(1).max(1.8),
  targetRole: z.string().max(200),
  targetIndustry: z.string().max(200),
  targetJob: objectId.nullable(),
  status: z.enum(["draft", "ready", "archived"]),
  sections: z.array(z.object({
    id: z.string().min(1).max(100),
    type: z.enum(["summary", "experience", "education", "skills", "projects", "certifications", "awards", "publications", "volunteer", "languages", "interests", "leadership", "coursework", "research", "achievements"]),
    title: z.string().trim().min(1).max(100),
    hidden: z.boolean().default(false),
    content: z.string().max(20000).optional(),
    entries: z.array(z.unknown()).max(50).optional(),
  }).transform((section, ctx) => {
    if (!section.entries) return section;
    const schema = supportingSchemas[section.type];
    if (!schema) { ctx.addIssue({ code: "custom", message: "This section does not support structured entries", path: ["entries"] }); return z.NEVER; }
    const parsed = z.array(schema).max(section.type === "languages" ? 30 : 50).safeParse(section.entries);
    if (!parsed.success) { for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: ["entries", ...issue.path] }); return z.NEVER; }
    const content = parsed.data.map(entry => Object.entries(entry).filter(([, value]) => value !== undefined && value !== "" && (!Array.isArray(value) || value.length)).map(([key, value]) => `${key.replace(/([A-Z])/g, " $1")}: ${Array.isArray(value) ? value.join(", ") : value}`).join("\n")).join("\n\n");
    if (content.length > 20000) { ctx.addIssue({ code: "custom", message: "Section content exceeds 20,000 characters", path: ["entries"] }); return z.NEVER; }
    return { ...section, entries: parsed.data, content };
  })).max(40).refine(items => new Set(items.map(item => item.id)).size === items.length, "Section ids must be unique"),
});

export const resumeSchemas = {
  create: z.object({
    body: z.object({
      title: z.string().trim().min(1, "Title is required").max(100),
    }),
  }),

  update: z.object({
    params: z.object({ id: objectId }),
    body: resumeWritableFields
      .partial()
      .refine((data) => Object.keys(data).length > 0, {
        message: "No valid fields provided to update",
      }),
  }),

  byId: z.object({
    params: z.object({ id: objectId }),
  }),

  list: z.object({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
      search: z.string().trim().max(100).optional(),
      sort: z
        .enum(["newest", "oldest", "title", "updated", "status", "score"])
        .default("newest"),
    }),
  }),
};

resumeSchemas.visibility = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ isPublic: z.boolean() }),
});

export const aiSchemas = {
  summaries: z.object({
    body: z.object({
      jobTitle: z.string().trim().min(1, "Job title is required").max(200),
      facts: z.string().trim().min(20).max(10000),
    }),
  }),

  experienceBullets: z.object({
    body: z.object({
      facts: z.string().trim().min(20).max(10000),
      positionTitle: z
        .string()
        .trim()
        .min(1, "Position title is required")
        .max(200),
    }),
  }),
};

const profileSkillItem = skillItem.extend({
  category: z.string().max(100).optional(),
});

// As with resumes, every writable field is listed. `user` and `userEmail` are
// absent, so a client cannot reassign a profile to another account.
export const careerProfileWritableFields = z.object({
  sections: resumeWritableFields.shape.sections,
  firstName: z.string().max(100),
  lastName: z.string().max(100),
  jobTitle: z.string().max(200),
  email: z.string().max(200),
  phone: z.string().max(50),
  address: z.string().max(300),
  website: z.string().max(500),
  linkedin: z.string().max(500),
  github: z.string().max(500),
  summary: z.string().max(20000),

  experience: z.array(experienceItem).max(50),
  education: z.array(educationItem).max(50),
  skills: z.array(profileSkillItem).max(200),
  projects: z.array(projectItem).max(50),
  certifications: z.array(certificationItem).max(50),
  achievements: z.array(achievementItem).max(50),
  awards: z.array(awardItem).max(50),
  publications: z.array(publicationItem).max(50),
  volunteer: z.array(volunteerItem).max(50),
  languages: z.array(languageItem).max(30),
  interests: z.array(z.string().max(100)).max(50),

  preferences: z.object({
    targetRoles: z.array(z.string().max(200)).max(20).optional(),
    targetIndustries: z.array(z.string().max(200)).max(20).optional(),
    employmentTypes: z.array(z.string().max(50)).max(10).optional(),
    locations: z.array(z.string().max(200)).max(20).optional(),
    remotePreference: z.string().max(50).optional(),
    salaryExpectation: z.string().max(100).optional(),
    noticePeriod: z.string().max(100).optional(),
  }),
});

// Only the sections a Resume can actually render today. Profile-only sections
// such as projects and certifications are excluded until the resume editor
// gains those sections, rather than silently discarding them on import.
export const IMPORTABLE_SECTIONS = [
  "personal",
  "summary",
  "experience",
  "education",
  "skills", "projects", "certifications", "awards", "publications", "volunteer", "languages", "interests", "leadership", "coursework", "research", "achievements",
];

export const careerProfileSchemas = {
  update: z.object({
    body: careerProfileWritableFields
      .partial()
      .refine((data) => Object.keys(data).length > 0, {
        message: "No valid fields provided to update",
      }),
  }),

  importToResume: z.object({
    params: z.object({ id: objectId }),
    body: z.object({
      sections: z
        .array(z.enum(IMPORTABLE_SECTIONS))
        .min(1, "Choose at least one section to import")
        .default(IMPORTABLE_SECTIONS),
    }),
  }),

  syncFromResume: z.object({
    params: z.object({ id: objectId }),
  }),
};

export { objectId };
