import mongoose from "mongoose";

const connectionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ["gmail", "whatsapp"],
      required: true,
    },
    status: {
      type: String,
      enum: ["connected", "disconnected", "error"],
      default: "disconnected",
    },

    // ─── Gmail-specific ───
    gmailEmail: { type: String, default: null },
    gmailTokens: { type: String, default: null }, // encrypted JSON
    gmailWatchExpiry: { type: Date, default: null },
    gmailHistoryId: { type: String, default: null },
    lastSyncAt: { type: Date, default: null },

    // ─── WhatsApp-specific (for later) ───
    waPhoneNumberId: { type: String, default: null },
    waAccessToken: { type: String, default: null }, // encrypted
    waDisplayPhone: { type: String, default: null },
  },
  { timestamps: true }
);

// One connection per channel per user
connectionSchema.index({ userId: 1, channel: 1 }, { unique: true });

export default connectionSchema;
