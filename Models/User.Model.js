import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },

  password: {
    type: String,
    required: true,
  },

  resumes: [{ type: mongoose.Schema.Types.ObjectId, ref: "Resume" }],
});

export const User = mongoose.model("User", userSchema);
