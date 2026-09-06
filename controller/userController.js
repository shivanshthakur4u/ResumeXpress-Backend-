import { asyncHandler } from "../utils/asyncHandler.js";
import * as authService from "../services/authService.js";

export const createUser = asyncHandler(async (req, res) => {
  const data = await authService.register(req.body);
  res.status(201).json({
    success: true,
    message: "User registered successfully",
    data,
  });
});

export const userSignin = asyncHandler(async (req, res) => {
  const data = await authService.signin(req.body);
  res.status(200).json({
    success: true,
    message: "User signed in successfully",
    data,
  });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await authService.requestPasswordReset(req.body);
  // Deliberately identical whether or not the address has an account.
  res.status(200).json({
    success: true,
    message:
      "If an account exists for that email, a reset link has been sent.",
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body);
  res.status(200).json({
    success: true,
    message: "Password reset successful",
  });
});
