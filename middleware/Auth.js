import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../Models/User.Model.js";

const extractToken = (req) => {
  const header = req.header("Authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
};

export const authMiddleware = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) throw ApiError.unauthorized("Authentication required");

    const decoded = jwt.verify(token, env.JWT_SECRET);

    // The account is re-read per request so that a deleted user, or a token
    // issued before the last password change, stops working immediately.
    const user = await User.findById(decoded.sub).select(
      "_id name email passwordChangedAt"
    );
    if (!user) throw ApiError.unauthorized("Account no longer exists");

    if (
      user.passwordChangedAt &&
      decoded.iat * 1000 < user.passwordChangedAt.getTime()
    ) {
      throw ApiError.unauthorized(
        "Your password was changed, please sign in again"
      );
    }

    req.user = { id: user._id.toString(), email: user.email, name: user.name };
    next();
  } catch (err) {
    next(err);
  }
};

// For endpoints that serve both public and owner views of a resource.
export const optionalAuth = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    const user = await User.findById(decoded.sub).select("_id name email");
    if (user) {
      req.user = { id: user._id.toString(), email: user.email, name: user.name };
    }
  } catch {
    // An invalid token is treated as an anonymous visitor rather than an error.
  }
  next();
};
