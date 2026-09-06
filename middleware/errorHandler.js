import { ZodError } from "zod";
import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";
import { env } from "../config/env.js";

export const notFoundHandler = (req, res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
};

const normalize = (err) => {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) {
    return ApiError.badRequest(
      "Validation failed",
      err.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }))
    );
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return ApiError.badRequest(
      "Validation failed",
      Object.values(err.errors).map((e) => ({
        field: e.path,
        message: e.message,
      }))
    );
  }

  if (err instanceof mongoose.Error.VersionError) return ApiError.conflict("This resume changed elsewhere. Reload before saving again.");

  if (err instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Invalid value for '${err.path}'`);
  }

  // Duplicate key
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern ?? {})[0] ?? "field";
    return ApiError.conflict(`That ${field} is already in use`);
  }

  if (err?.name === "JsonWebTokenError") {
    return ApiError.unauthorized("Invalid authentication token");
  }
  if (err?.name === "TokenExpiredError") {
    return ApiError.unauthorized("Your session has expired, please sign in again");
  }

  return null;
};

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
export const errorHandler = (err, req, res, next) => {
  const normalized = normalize(err);
  const isUnexpected = normalized === null;
  const apiError = normalized ?? ApiError.internal();

  if (isUnexpected || apiError.statusCode >= 500) {
    console.error(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`,
      { name: err?.name, status: apiError.statusCode }
    );
  }

  res.status(apiError.statusCode).json({
    success: false,
    message: apiError.message,
    ...(apiError.details ? { errors: apiError.details } : {}),

  });
};
