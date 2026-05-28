import mongoose from "mongoose";

const historyEntrySchema = new mongoose.Schema(
  {
    toolName: { type: String, required: true },
    cost: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);

const creditAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    tier: {
      type: String,
      enum: ["free", "growth", "pro", "enterprise"],
      default: "free",
    },
    credits: { type: Number, default: 40, min: 0 },
    monthlyAllocation: { type: Number, default: 40 },
    unlimited: { type: Boolean, default: false },
    lastRefill: { type: Date, default: Date.now },
    totalUsed: { type: Number, default: 0 },
    history: { type: [historyEntrySchema], default: [] },
  },
  { timestamps: true },
);

export default creditAccountSchema;
