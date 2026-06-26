import mongoose from "mongoose";

/**
 * In-app notification — the delivery sink for `notify_broker` and `compose_digest`
 * (and reusable for future alerts). The engine writes one of these whenever a node
 * emits a `notify` payload, so broker alerts and the daily digest actually land
 * somewhere the UI can show, rather than vanishing into the event log.
 */
const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    source: { type: String, default: "sequence" }, // "sequence" | "digest" | ...
    title: { type: String, default: "" },
    message: { type: String, required: true },
    priority: { type: String, enum: ["high", "medium", "low"], default: "medium" },
    read: { type: Boolean, default: false },

    // Optional provenance so the UI can deep-link.
    sequenceId: { type: mongoose.Schema.Types.ObjectId, ref: "Sequence", default: null },
    enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: "SequenceEnrollment", default: null },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

export default notificationSchema;
