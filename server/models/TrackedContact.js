import mongoose from "mongoose";

const trackedContactSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    source: {
      type: String,
      enum: ["client", "imported"],
      default: "imported",
    },
    clientRef: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    channels: {
      gmail: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
      sms: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

// Unique contact per user per email (avoid duplicates)
trackedContactSchema.index(
  { userId: 1, email: 1 },
  { unique: true, sparse: true }
);

export default trackedContactSchema;
