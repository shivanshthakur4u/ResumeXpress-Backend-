
import express from "express";
import { createUser, userSignin } from "../controller/userController.js";

 const router = express.Router();

router.post("/register", createUser);

router.post("/signin", userSignin);

export default router;
