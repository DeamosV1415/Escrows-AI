import { getProvider } from "./providers/index.js";
import { PLANS } from "../config/plans.js";
import { applyPlanChange } from "../sequences/capSweep.js";
import { BillingError } from "./errors.js";

export { BillingError };

/** Is the active billing provider configured (keys present)? */
export function isBillingConfigured() {
  return getProvider().isConfigured();
}

/**
 * Start a subscription via the active provider's hosted checkout. Returns { url }
 * to redirect the browser to. Provider-agnostic — all provider specifics live in
 * server/billing/providers/*.
 */
export async function createCheckoutSession(models, userId, plan, interval, { successUrl, cancelUrl }) {
  if (!PLANS[plan] || plan === "free") throw new BillingError("Choose a paid plan to subscribe.");
  if (interval !== "month" && interval !== "year") throw new BillingError("Invalid billing interval.");
  return getProvider().createCheckout({ models, userId, plan, interval, successUrl, cancelUrl });
}

/** Open the active provider's self-service customer portal. Returns { url }. */
export async function createPortalSession(models, userId, returnUrl) {
  return getProvider().createPortal({ models, userId, returnUrl });
}

/**
 * Verify + handle a billing webhook. The provider verifies the signature and returns
 * a normalized result; we resolve the user and funnel it through applyPlanChange —
 * the single authoritative plan mutation (syncs plan, credits, status, grace).
 * Idempotent (applyPlanChange gates the credit grant on an actual tier change).
 */
export async function handleWebhook(models, rawBody, headers) {
  const normalized = await getProvider().parseWebhook(rawBody, headers);
  if (!normalized) return null;

  const { User } = models;
  let user = null;
  if (normalized.userId) user = await User.findById(normalized.userId).select("_id").lean();
  if (!user && normalized.customerId) {
    user = await User.findOne({ billingCustomerId: normalized.customerId }).select("_id").lean();
  }
  if (!user) {
    console.warn("⚠️ Billing reconcile: no matching user for", normalized.customerId);
    return null;
  }

  return applyPlanChange(models, user._id, normalized.plan, normalized.meta);
}

/** Read-only billing summary for the Settings → Billing UI (from our cached fields). */
export function billingSummary(user) {
  const plan = user?.plan || "free";
  const cfg = PLANS[plan] || PLANS.free;
  return {
    plan,
    planLabel: cfg.label,
    interval: user?.planInterval || null,
    status: user?.subscriptionStatus || (plan === "free" ? "free" : null),
    price: cfg.price,
    renewsAt: user?.planRenewsAt || null,
    cancelAtPeriodEnd: !!user?.cancelAtPeriodEnd,
    hasBillingAccount: !!user?.billingCustomerId,
    provider: getProvider().name,
  };
}
