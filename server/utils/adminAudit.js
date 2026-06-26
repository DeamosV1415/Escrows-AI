/**
 * Singleton wrapper around the AdminAudit model so admin route handlers can
 * record audit entries without threading the model through constructors.
 * index.js calls initAdminAudit(AdminAudit) once at boot.
 *
 * logAdminAction is fire-and-forget and never throws — a failed audit write
 * must not break the admin action, but it IS logged to the console so a
 * broken audit trail does not fail silently.
 */
let AdminAuditModel = null;

export function initAdminAudit(model) {
  AdminAuditModel = model;
}

/**
 * @param {object} req     Express request — used to pull admin identity + client info.
 * @param {object} entry   { action, targetUserId?, targetEmail?, changes? }
 */
export function logAdminAction(req, entry) {
  if (!AdminAuditModel || !req?.userId) return;

  AdminAuditModel.create({
    adminId: req.userId,
    adminEmail: req.adminEmail || "",
    action: entry.action,
    method: req.method,
    path: req.originalUrl || req.url,
    targetUserId: entry.targetUserId,
    targetEmail: entry.targetEmail || "",
    changes: entry.changes || [],
    ip: req.ip || req.headers["x-forwarded-for"] || "",
    userAgent: req.headers["user-agent"] || "",
    at: new Date(),
  }).catch((err) => console.error("⚠️ admin audit log failed:", err.message));
}
