import { AnalyticsEvent } from "../Models/CareerWorkspace.Model.js";
// Analytics must never turn an otherwise successful edit into a failed request.
export const recordEvent = async (userEmail, event, resource) => {
  if (!userEmail) return;
  try { await AnalyticsEvent.create({ userEmail, event, resource }); }
  catch { console.error("Analytics event could not be recorded", { event }); }
};
