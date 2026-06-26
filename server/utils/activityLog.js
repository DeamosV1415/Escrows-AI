/**
 * Tiny singleton wrapper around the Activity model so route handlers can log
 * without threading the model through every router constructor. index.js calls
 * initActivityLog(Activity) once at boot; everything else imports logActivity.
 *
 * logActivity is fire-and-forget and never throws — a failed log must not break
 * the user action that produced it.
 */
let ActivityModel = null;

export function initActivityLog(model) {
  ActivityModel = model;
}

export function logActivity({ userId, category, action, title, meta }) {
  if (!ActivityModel || !userId) return;
  ActivityModel.create({
    userId,
    category,
    action,
    title: title || "",
    meta: meta || {},
    at: new Date(),
  }).catch((err) => console.error("⚠️ activity log failed:", err.message));
}
