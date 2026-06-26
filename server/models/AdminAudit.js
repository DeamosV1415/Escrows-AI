import mongoose from "mongoose";

/**
 * Append-only audit trail for admin-panel actions. Separate from the Activity
 * feed (which is per-user and surfaces in the dashboard) because these are
 * security records: who did what, to whom, from where, and when. Never exposed
 * in the regular UI — read it directly or via a future admin-only audit view.
 *
 * Writes are best-effort (see utils/adminAudit.js): a failed audit write must
 * never block the admin action it describes — but it IS logged loudly so a
 * silently-failing audit trail is noticeable.
 */
const adminAuditSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    adminEmail: { type: String, required: true },
    action: { type: String, required: true }, // e.g. "user.update", "user.view"
    method: { type: String, default: "" },    // HTTP verb
    path: { type: String, default: "" },       // request path
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    targetEmail: { type: String, default: "" },
    changes: { type: [String], default: [] },  // human-readable diff list
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

// Newest-first scans, plus per-admin and per-target lookups.
adminAuditSchema.index({ at: -1 });
adminAuditSchema.index({ adminId: 1, at: -1 });
adminAuditSchema.index({ targetUserId: 1, at: -1 });

export default adminAuditSchema;
