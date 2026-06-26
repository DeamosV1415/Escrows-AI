import mongoose from "mongoose";

/**
 * Append-only analytics stream. Every meaningful engine action emits one of these
 * from day one, so the Analytics tab (Phase 2) has real data the moment it's built.
 */
const sequenceEventSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    sequenceId: { type: mongoose.Schema.Types.ObjectId, ref: "Sequence", required: true },
    enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: "SequenceEnrollment", default: null },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", default: null },

    type: {
      type: String,
      enum: [
        "enrolled",
        "node_entered",
        "message_sent",
        "message_failed",
        "replied",
        "branched",
        "deferred",
        "halted",
        "completed",
        "goal_met",
        "failed",
      ],
      required: true,
    },
    nodeId: { type: String, default: null },
    handle: { type: String, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

sequenceEventSchema.index({ userId: 1, sequenceId: 1, at: -1 });
sequenceEventSchema.index({ enrollmentId: 1, at: 1 });

export default sequenceEventSchema;
