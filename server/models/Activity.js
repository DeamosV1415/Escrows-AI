import mongoose from "mongoose";

/**
 * Append-only activity log for the dashboard "Recent Activity" feed. Only sources
 * that have no event stream of their own write here — client CRUD and inventory
 * upload/delete. Inbox messages (Message) and sequence events (SequenceEvent)
 * already live in their own timestamped collections and are merged in at read time,
 * so they are NOT duplicated here.
 *
 * Writes are best-effort (see utils/activityLog.js): a failed log must never break
 * the action that triggered it.
 */
const activitySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    category: { type: String, enum: ["client", "inventory"], required: true },
    action: { type: String, required: true }, // created | updated | deleted | uploaded
    title: { type: String, default: "" },     // human-readable summary
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

// The feed's hot query: newest-first per user.
activitySchema.index({ userId: 1, at: -1 });

export default activitySchema;
