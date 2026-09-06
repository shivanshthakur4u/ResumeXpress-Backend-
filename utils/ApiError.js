export class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
    // Distinguishes errors we raised deliberately from unexpected crashes,
    // so the handler knows which messages are safe to show a client.
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = "Bad request", details) {
    return new ApiError(400, message, details);
  }
  static unauthorized(message = "Authentication required") {
    return new ApiError(401, message);
  }
  static forbidden(message = "You do not have access to this resource") {
    return new ApiError(403, message);
  }
  static notFound(message = "Resource not found") {
    return new ApiError(404, message);
  }
  static conflict(message = "Resource already exists") {
    return new ApiError(409, message);
  }
  static tooManyRequests(message = "Too many requests") {
    return new ApiError(429, message);
  }
  static internal(message = "Internal server error") {
    return new ApiError(500, message);
  }
  static serviceUnavailable(message = "Service temporarily unavailable") {
    return new ApiError(503, message);
  }
}
