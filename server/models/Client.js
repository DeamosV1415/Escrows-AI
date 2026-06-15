import mongoose from "mongoose";

const clientSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    company: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    stage: {
      type: String,
      enum: ["Lead", "Engaged", "Under Contract", "Closed"],
      default: "Lead",
    },
    intent: {
      type: String,
      enum: ["hot", "warm", "cold"],
      default: "warm",
    },
    budget: { type: Number, default: 0 },
    requirements: { type: String, default: "" },
    nextAction: { type: String, default: "" },
    nextActionPriority: {
      type: String,
      enum: ["high", "medium", "low"],
      default: "medium",
    },
    notes: { type: String, default: "" },
    // IANA timezone of the client (e.g. "America/Los_Angeles"). Used to evaluate a sequence's
    // quiet hours in the recipient's local time when that sequence opts into quiet hours.
    // Optional — falls back to the broker/sequence timezone when unset.
    timezone: { type: String, default: null },
    // When true, the sequence engine will not enroll or send to this client (unsubscribe).
    optedOut: { type: Boolean, default: false },

    // ─── Transaction / escrow tracking (Tier-2: Contract-to-Close) ───
    // Lightweight: deadline dates + a coarse milestone status. Read live by the engine
    // (wait_until resolves these), settable via the update_client block or the client modal.
    transaction: {
      status: {
        type: String,
        enum: ["none", "active", "inspection", "appraisal", "loan", "clear_to_close", "closed"],
        default: "none",
      },
      contractDate: { type: Date, default: null },
      inspectionDate: { type: Date, default: null },
      appraisalDate: { type: Date, default: null },
      loanContingencyDate: { type: Date, default: null },
      closingDate: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

// Text index for search
clientSchema.index({ name: "text", email: "text", company: "text" });

export default clientSchema;
