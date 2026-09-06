import express from "express";
import {
  createUser,
  forgotPassword,
  resetPassword,
  userSignin,
} from "../controller/userController.js";
import { validate } from "../middleware/validate.js";
import { authSchemas } from "../validation/schemas.js";
import { authLimiter, passwordResetLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

router.post(
  "/register",
  authLimiter,
  validate(authSchemas.register),
  createUser
);

router.post("/signin", authLimiter, validate(authSchemas.signin), userSignin);

router.post(
  "/forgot-password",
  passwordResetLimiter,
  validate(authSchemas.forgotPassword),
  forgotPassword
);

router.post(
  "/reset-password",
  passwordResetLimiter,
  validate(authSchemas.resetPassword),
  resetPassword
);

export default router;
