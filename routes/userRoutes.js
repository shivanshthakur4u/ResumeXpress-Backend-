import express from "express";
import {
  createUser,
  forgotPassword,
  resetPassword,
  userSignin,
} from "../controller/userController.js";

const router = express.Router();

router.post("/register", createUser);

router.post("/signin", userSignin);

router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
export default router;
