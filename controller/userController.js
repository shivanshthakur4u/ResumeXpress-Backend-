import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../Models/User.Model.js";
import nodemailer from 'nodemailer';
import crypto from 'crypto';


export const createUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const user = await User.findOne({ email: email });
    if (user) {
      return res.status(400).json({
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
    return res.status(201).json({
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
    return res.status(200).json({
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



export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpiry;
    await user.save();

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: process.env.EMAIL_USER, 
      to: email,
      subject: 'Password Reset Request',
      html: `
        <h1>You requested a password reset</h1>
        <p>Click this <a href="${resetUrl}">link</a> to reset your password.</p>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `
    };
    const transporter = nodemailer.createTransport({
       host: "smtp.gmail.com",
      auth: {
        type: "login",
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD
      }
    });
    
    // Send email with better error handling
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log('Email sent successfully:', info.response);
      res.status(200).json({
        success: true,
        message: "Password reset link sent to email"
      });
    } catch (emailError) {
      console.error('Detailed email error:', emailError);
      
      // Reset the user's token since email failed
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();
      
      return res.status(500).json({
        success: false,
        message: "Failed to send reset email",
        error: emailError.message
      });
    }

  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({
      success: false,
      message: "Error in reset password process",
      error: err.message
    });
  }
};

//  reset password
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token"
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user's password and clear reset token fields
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password reset successful"
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: "Error resetting password"
    });
  }
};