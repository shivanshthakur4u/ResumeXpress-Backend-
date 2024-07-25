import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../Models/User.Model.js";

export const createUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const user = await User.findOne({ email: email });
    if (user) {
      res.status(400).json({
        success: false,
        message: "User already exists",
      });
    }
    const hashedpassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      name,
      password: hashedpassword,
      email,
    });

    await newUser.save();
    const token = jwt.sign({ email: newUser.email }, process.env.JWT_SECRET, {
      expiresIn: "48h",
    });
    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: {
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        token: token,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

export const userSignin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const isUser = await User.findOne({ email: email });
    if (!isUser) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }
    const isValidPassword = await bcrypt.compare(password, isUser.password);
    if (!isValidPassword) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }
    const token = jwt.sign({ email: isUser.email }, process.env.JWT_SECRET, {
      expiresIn: "48h",
    });
    res.status(200).json({
      success: true,
      message: "User signed in successfully",
      data: {
        _id: isUser._id,
        name: isUser.name,
        email: isUser.email,
        token: token,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};
