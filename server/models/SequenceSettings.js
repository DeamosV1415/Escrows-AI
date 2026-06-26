import mongoose from "mongoose";

/**
 * Per-broker sequence controls. The `killSwitch` halts all of a broker's sequence
 * execution instantly (complementing the global env-level SEQUENCES_GLOBAL_KILL).
 */
const sequenceSettingsSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    killSwitch: { type: Boolean, default: false },
    defaultTimezone: { type: String, default: "UTC" },
    defaultQuietHours: {
      start: { type: String, default: "21:00" },
      end: { type: String, default: "08:00" },
    },

    // Per-broker sequence defaults. These are the AUTHORITATIVE source for the
    // engine — per-sequence overrides are deferred (Sequence.settings is dormant).
    // The rate cap is per-broker by nature: the engine counts a client's outbound
    // messages across ALL sequences in 24h, so the limit can only live in one place.
    maxPerClientPerDay: { type: Number, default: 5, min: 0 },
    stopOnReply: { type: Boolean, default: true },
    stopOnClosed: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export default sequenceSettingsSchema;
