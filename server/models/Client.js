import mongoose from "mongoose";

const clientSchema = new mongoose.Schema(
  {
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
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

// Text index for search
clientSchema.index({ name: "text", email: "text", company: "text" });

export default clientSchema;
