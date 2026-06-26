// ─── Central plan catalog — the single source of truth for every tier limit ───
//
// All tier-differentiated limits live here so enforcement (backend), the usage
// bars / paywalls (frontend), and billing all read the same numbers. Adding or
// retuning a plan happens in exactly one place.
//
// Numbers mirror the pricing page (src/components/PricingPage.tsx):
//   Free   100 MB · 2 active seqs · 40 credits/mo  · 5 call summaries/mo
//   Growth 2 GB   · 8 active seqs · 250 credits/mo · 150 call summaries/mo
//   Pro    10 GB  · 15 active seqs· 700 credits/mo · 500 call summaries/mo · deal signals
//
// This catalog is provider-agnostic: it holds only business limits + display price.
// The mapping of plan+interval → a payment provider's product/price ID lives inside
// each provider module (server/billing/providers/*), keyed off env vars, so swapping
// providers never touches this file.

export const PLANS = {
  free: {
    id: "free",
    label: "Free",
    credits: 40,
    storageMB: 100,
    activeSequences: 2,
    callSummaries: 5,
    dealSignals: false,
    price: { month: 0, year: 0 },
  },
  growth: {
    id: "growth",
    label: "Growth",
    credits: 250,
    storageMB: 2048, // 2 GB
    activeSequences: 8,
    callSummaries: 150,
    dealSignals: false,
    price: { month: 35, year: 30 }, // year = per-month rate when billed annually
  },
  pro: {
    id: "pro",
    label: "Pro",
    credits: 700,
    storageMB: 10240, // 10 GB
    activeSequences: 15,
    callSummaries: 500,
    dealSignals: true,
    price: { month: 70, year: 60 },
  },
};

export const PLAN_IDS = Object.keys(PLANS);

const MB = 1024 * 1024;

/** Resolve a plan id to its config, falling back to Free for unknown/missing. */
export function getPlan(plan) {
  return PLANS[plan] || PLANS.free;
}

/**
 * Generic limit accessor — `getPlanLimit("growth", "callSummaries")`. Returns the
 * Free value for unknown plans so the backend stays safe before billing sets a plan.
 */
export function getPlanLimit(plan, key) {
  return getPlan(plan)[key];
}

/**
 * Feature flag / capability check — `planAllows(plan, "dealSignals")`. For boolean
 * feature gates; numeric limits use getPlanLimit. Unknown plan → Free's value.
 */
export function planAllows(plan, feature) {
  return !!getPlan(plan)[feature];
}

// ─── Storage ───
export const STORAGE_LIMITS_MB = Object.fromEntries(
  PLAN_IDS.map((id) => [id, PLANS[id].storageMB]),
);

export function getStorageLimitBytes(plan) {
  return getPlan(plan).storageMB * MB;
}

export function getStorageLimitMB(plan) {
  return getPlan(plan).storageMB;
}

// ─── Active-sequence caps ───
// How many sequences a plan may keep ACTIVE (enrolled/running) at once. Drafts are
// unlimited; only simultaneous active count is gated. Enforced at activation time
// and by the downgrade sweep (server/sequences/capSweep.js).
export const ACTIVE_SEQUENCE_LIMITS = Object.fromEntries(
  PLAN_IDS.map((id) => [id, PLANS[id].activeSequences]),
);

export function getActiveSequenceLimit(plan) {
  return getPlan(plan).activeSequences;
}
