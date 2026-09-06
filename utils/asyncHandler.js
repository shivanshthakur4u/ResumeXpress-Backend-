// Routes previously swallowed rejections in a catch that only logged, leaving
// the request hanging until the client timed out. Wrapping forces every
// rejection into the central error handler instead.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
