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

    // ─── Subscription plan (drives storage limits) ───
    // Defaults to "free"; onboarding plan-selection / billing will set this later.
    // Mongoose applies the default on read, so existing users hydrate as "free"
    // with no data migration needed.
    plan: { type: String, enum: ["free", "growth", "pro"], default: "free" },

    // When a downgrade leaves a user with more ACTIVE sequences than their new
    // plan allows, we don't pause anything immediately — we stamp a grace deadline
    // here (now + grace window). The scheduler sweep auto-pauses the excess (keeping
    // the most-recently-activated ones) once this passes, then clears it back to null.
    // null = not over any cap / nothing pending. Dormant until billing sets it.
    planGraceUntil: { type: Date, default: null },

    // ─── Billing linkage (provider-agnostic cache; the provider is source of truth) ───
    // Populated/maintained by the billing webhook. The app gates features off `plan`
    // above; these fields back the Settings → Billing UI and the Portal handoff.
    // Provider-neutral on purpose so swapping Stripe ⇄ Dodo ⇄ … touches no schema.
    billingProvider: { type: String, default: null }, // "stripe" | "dodo" | …
    billingCustomerId: { type: String, default: null, index: true },
    billingSubscriptionId: { type: String, default: null },
    subscriptionStatus: {
      // Normalized across providers: active | trialing | past_due | canceled | incomplete
      type: String,
      enum: ["active", "trialing", "past_due", "canceled", "incomplete", "incomplete_expired", "unpaid", null],
      default: null,
    },
    planInterval: { type: String, enum: ["month", "year", null], default: null },
    planRenewsAt: { type: Date, default: null }, // next renew date, or access-until if canceling
    cancelAtPeriodEnd: { type: Boolean, default: false },

    // Watermark for the dashboard "Recent Activity" feed: clearing the feed sets this
    // to now, and the feed only returns items newer than it. Non-destructive — the
    // underlying messages / sequence events are never deleted.
    activityClearedAt: { type: Date, default: null },

    // The dashboard "Get started" checklist hides itself once every step is done. This
    // lets a broker dismiss it early; it stays hidden afterwards. Separate from
    // profileComplete (which only gates the first-run onboarding redirect) so the
    // checklist remains a resumable nudge even when onboarding was skipped.
    getStartedDismissed: { type: Boolean, default: false },
  },
  { timestamps: true, autoIndex: false },
);

export default userSchema;
