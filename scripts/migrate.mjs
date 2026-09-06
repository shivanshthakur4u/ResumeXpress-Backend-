import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import "../Models/User.Model.js";
import "../Models/Resume.Model.js";
import "../Models/CareerProfile.Model.js";
import "../Models/ResumeVersion.Model.js";
import "../Models/CareerWorkspace.Model.js";
try {
  await connectDB();
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  console.log("Indexes created. Existing resume content was not rewritten.");
} finally { await mongoose.disconnect(); }
