import { AsyncLocalStorage } from "node:async_hooks";

// Carries a per-request deadline without threading a parameter through every
// service call. Slow work reads the time actually remaining rather than
// assuming a fixed budget: a fixed AI budget still overran, because the cold
// start, the database connection and the context queries had already spent
// most of the platform's function limit before the AI call began.
export const requestContext = new AsyncLocalStorage();

// Deliberately below the platform's function timeout. If the platform kills the
// request first it serves its own error page, which carries no CORS headers and
// surfaces in the browser as a misleading CORS failure.
export const REQUEST_BUDGET_MS = Number(process.env.REQUEST_BUDGET_MS ?? 9_000);

export const withRequestDeadline = (req, res, next) =>
  requestContext.run({ deadline: Date.now() + REQUEST_BUDGET_MS }, next);

// Milliseconds left for this request, capped at `cap`. Outside a request
// (scripts, tests) there is no deadline, so the cap applies unchanged.
export const remainingBudget = (cap) => {
  const deadline = requestContext.getStore()?.deadline;
  if (!deadline) return cap;
  return Math.max(0, Math.min(cap, deadline - Date.now()));
};
