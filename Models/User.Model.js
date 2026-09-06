import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: {
      type: String,
      required: true,
      // Excluded by default so a stray findOne() can never serialise the hash
      // back to a client. Sign-in opts in with .select("+password").
      select: false,
    },
    // Stored as a SHA-256 hash. A leaked database snapshot then cannot be used
    // to mint working reset links.
    resetPasswordToken: {
      type: String,
      select: false,
      index: true,
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },
    // Lets auth reject tokens that were issued before the last password change.
    passwordChangedAt: {
      type: Date,
    },

    resumes: [{ type: mongoose.Schema.Types.ObjectId, ref: "Resume" }],
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);
