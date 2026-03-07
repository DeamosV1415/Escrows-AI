import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    password: { type: String, default: null },
    googleId: { type: String, default: null },
    avatar: { type: String, default: null },

    // ─── Profile fields (filled during onboarding) ───
    profileComplete: { type: Boolean, default: false },
    phone: { type: String, trim: true, default: "" },
    company: { type: String, trim: true, default: "" },
    jobTitle: { type: String, trim: true, default: "" },
    licenseNumber: { type: String, trim: true, default: "" }, // Real estate / broker license
    yearsInBusiness: { type: Number, default: null },
    location: { type: String, trim: true, default: "" }, // City / State
    specialization: { type: String, trim: true, default: "" }, // e.g. Residential, Commercial, Land
    teamSize: { type: String, trim: true, default: "" }, // Solo, 2-5, 6-20, 20+
  },
  { timestamps: true },
);

export default userSchema;
