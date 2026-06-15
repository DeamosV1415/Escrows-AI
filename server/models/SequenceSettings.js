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
  },
  { timestamps: true },
);

export default sequenceSettingsSchema;
