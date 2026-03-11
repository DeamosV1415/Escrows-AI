import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ["gmail", "whatsapp", "sms"],
      required: true,
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    contactName: { type: String, default: "" },
    contactIdentifier: { type: String, default: "" }, // email or phone

    externalId: { type: String, default: null }, // Gmail message ID or WA message ID
    threadId: { type: String, default: null }, // Gmail thread ID

    direction: {
      type: String,
      enum: ["inbound", "outbound"],
      required: true,
    },
    body: { type: String, default: "" },
    subject: { type: String, default: "" }, // Gmail only

    status: {
      type: String,
      enum: ["delivered", "read", "failed"],
      default: "delivered",
    },
    timestamp: { type: Date, default: Date.now },
    rawPayload: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// Indexes for fast conversation lookups
messageSchema.index({ userId: 1, contactIdentifier: 1, timestamp: -1 });
messageSchema.index({ userId: 1, threadId: 1 });
messageSchema.index({ externalId: 1 }, { sparse: true });

export default messageSchema;
