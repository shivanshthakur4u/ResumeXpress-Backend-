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
      err
    );
  }

  res.status(apiError.statusCode).json({
    success: false,
    message: apiError.message,
    ...(apiError.details ? { errors: apiError.details } : {}),
    // Stack traces are a disclosure risk, so they are development-only.
    ...(env.isProduction ? {} : { stack: err?.stack }),
  });
};
