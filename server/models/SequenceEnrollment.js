import mongoose from "mongoose";

/**
 * One subject (a client, or the broker for schedule-triggered sequences) travelling
 * through one sequence. This is the engine's durable work queue: it polls for rows
 * with status="active" and nextRunAt <= now.
 *
 * `graphSnapshot` is the resolved sequence graph captured at enrollment time — the
 * engine runs THIS, never the live Sequence doc, so editing a sequence can never
 * corrupt in-flight enrollments.
 *
 * `lock` implements an atomic claim (see engine.claimOne): a tick flips active->running
 * with a lockedUntil; only the claimer executes. Crashed locks are reclaimed after TTL.
 *
 * `inFlight` is the pre-send durable marker for crash-safe, effectively-once sends.
 */
const historyEntrySchema = new mongoose.Schema(
  {
    nodeId: { type: String, required: true },
    type: { type: String, required: true },
    status: { type: String, enum: ["done", "failed", "skipped", "deferred"], required: true },
    handleFollowed: { type: String, default: null },
    externalId: { type: String, default: null },
    detail: { type: String, default: "" },
    error: { type: String, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const sequenceEnrollmentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sequenceId: { type: mongoose.Schema.Types.ObjectId, ref: "Sequence", required: true },
    sequenceVersion: { type: Number, default: 1 },

    graphSnapshot: {
      nodes: { type: [mongoose.Schema.Types.Mixed], default: [] },
      edges: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },

    // null for schedule/broker-scoped sequences (the digest).
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", default: null },

    status: {
      type: String,
      enum: ["active", "running", "completed", "halted", "failed"],
      default: "active",
    },

    currentNodeId: { type: String, default: null },
    nextRunAt: { type: Date, default: Date.now },

    // wait_for_reply bookkeeping: which node armed the wait and when.
    waitContext: {
      nodeId: { type: String, default: null },
      startedAt: { type: Date, default: null },
    },

    // pre-send durable marker for crash-safe sends.
    inFlight: {
      nodeId: { type: String, default: null },
      body: { type: String, default: null },
      startedAt: { type: Date, default: null },
    },

    // per-node retry counters: { [nodeId]: attempts }
    attempts: { type: mongoose.Schema.Types.Mixed, default: {} },

    stepsExecuted: { type: Number, default: 0 },

    history: { type: [historyEntrySchema], default: [] },

    lock: {
      lockedBy: { type: String, default: null },
      lockedUntil: { type: Date, default: null },
    },

    enrolledAt: { type: Date, default: Date.now },
    haltReason: { type: String, default: null },

    // First time the client replied while in this enrollment. Set once (dedup) so the
    // analytics "Replied" funnel + reply rate count each enrollment at most once.
    repliedAt: { type: Date, default: null },

    // Why an active enrollment is currently waiting to send (quiet hours / rate cap / kill
    // switch). Surfaced in the UI so a deferred send never looks like a silent failure.
    // Cleared once the send goes out or the enrollment advances normally.
    hold: {
      reason: { type: String, default: null },
      until: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

// The engine's hot query.
sequenceEnrollmentSchema.index({ status: 1, nextRunAt: 1 });
// One active enrollment per (sequence, client). Partial so completed/halted rows don't block re-enrollment.
sequenceEnrollmentSchema.index(
  { sequenceId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["active", "running"] } } },
);

export default sequenceEnrollmentSchema;
