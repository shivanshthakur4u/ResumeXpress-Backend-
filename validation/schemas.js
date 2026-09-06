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

// Every writable resume field is listed explicitly. Anything absent here —
// notably `userEmail` and `_id` — is stripped by zod before it reaches the
// document, which is what stops a client reassigning a resume to another user.
const resumeWritableFields = z.object({
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
        .enum(["newest", "oldest", "title", "updated"])
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
    }),
  }),

  experienceBullets: z.object({
    body: z.object({
      positionTitle: z
        .string()
        .trim()
        .min(1, "Position title is required")
        .max(200),
    }),
  }),
};

export { objectId };
