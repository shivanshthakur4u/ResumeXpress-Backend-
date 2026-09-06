import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { User } from "../Models/User.Model.js";
import { ApiError } from "../utils/ApiError.js";
import { env } from "../config/env.js";
import { sendPasswordResetEmail, isEmailConfigured } from "./emailService.js";

const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const signToken = (user) =>
  jwt.sign({ sub: user._id.toString() }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });

// The response shape the existing frontend already consumes.
const toAuthPayload = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  token: signToken(user),
});

const hashResetToken = (raw) =>
  crypto.createHash("sha256").update(raw).digest("hex");

export const register = async ({ name, email, password }) => {
  const existing = await User.findOne({ email });
  if (existing) throw ApiError.conflict("An account with this email already exists");

  const user = await User.create({
    name,
    email,
    password: await bcrypt.hash(password, BCRYPT_ROUNDS),
  });

  return toAuthPayload(user);
};

export const signin = async ({ email, password }) => {
  const user = await User.findOne({ email }).select("+password");

  // The same generic message is returned whether the account is missing or the
  // password is wrong, so this endpoint cannot be used to discover which
  // emails are registered.
  const invalid = ApiError.badRequest("Invalid email or password");
  if (!user) {
    // Equalises timing against the bcrypt.compare branch below.
    await bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin");
    throw invalid;
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) throw invalid;

  return toAuthPayload(user);
};

export const requestPasswordReset = async ({ email }) => {
  const user = await User.findOne({ email });

  // Always reports success. Returning 404 for unknown emails previously let
  // anyone enumerate which addresses have accounts.
  if (!user) return;

  if (!isEmailConfigured()) {
    throw ApiError.serviceUnavailable(
      "Password reset is unavailable because email is not configured"
    );
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  user.resetPasswordToken = hashResetToken(rawToken);
  user.resetPasswordExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await user.save();

  // Must match the frontend's actual route. This previously pointed at
  // /reset-password, which does not exist, so every reset link 404'd.
  const resetUrl = `${env.FRONTEND_URL}/auth/reset-password?token=${rawToken}`;

  try {
    await sendPasswordResetEmail({ to: user.email, resetUrl });
  } catch (err) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    console.error("Password reset email failed:", err);
    // The underlying SMTP error is logged but not returned; it leaks transport
    // and account detail to the caller.
    throw ApiError.serviceUnavailable(
      "We couldn't send the reset email. Please try again later."
    );
  }
};

export const resetPassword = async ({ token, newPassword }) => {
  const user = await User.findOne({
    resetPasswordToken: hashResetToken(token),
    resetPasswordExpires: { $gt: new Date() },
  }).select("+resetPasswordToken +resetPasswordExpires");

  if (!user) throw ApiError.badRequest("This reset link is invalid or has expired");

  user.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  // Invalidates every JWT issued before this moment.
  user.passwordChangedAt = new Date();
  await user.save();
};
