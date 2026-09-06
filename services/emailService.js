import nodemailer from "nodemailer";
import { env } from "../config/env.js";

// Built once at module load rather than per request, so we are not opening a
// fresh SMTP connection pool on every password reset.
const transporter = env.emailEnabled
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.EMAIL_USER,
        pass: env.EMAIL_APP_PASSWORD,
      },
    })
  : null;

export const isEmailConfigured = () => transporter !== null;

export const sendMail = async ({ to, subject, html }) => {
  if (!transporter) {
    throw new Error("Email transport is not configured");
  }
  return transporter.sendMail({ from: env.EMAIL_USER, to, subject, html });
};

export const sendPasswordResetEmail = async ({ to, resetUrl }) =>
  sendMail({
    to,
    subject: "Reset your ResumeXpress password",
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px">
        <h2 style="margin:0 0 16px">Reset your password</h2>
        <p style="margin:0 0 16px;color:#444">
          We received a request to reset your ResumeXpress password.
        </p>
        <p style="margin:0 0 24px">
          <a href="${resetUrl}"
             style="display:inline-block;padding:10px 18px;background:#1f2937;color:#fff;
                    border-radius:6px;text-decoration:none">Reset password</a>
        </p>
        <p style="margin:0 0 8px;color:#666;font-size:13px">
          This link expires in 1 hour.
        </p>
        <p style="margin:0;color:#666;font-size:13px">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });
