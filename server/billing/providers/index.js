import * as stripe from "./stripe.js";
import * as dodo from "./dodo.js";

/**
 * Billing provider registry + selector.
 *
 * Set BILLING_PROVIDER=stripe|dodo to choose (defaults to "dodo"). To add a new
 * provider, drop a module in this folder implementing the contract below and
 * register it here — nothing else in the app needs to change.
 *
 * ── Provider contract ──
 *   name: string
 *   isConfigured(): boolean
 *   createCheckout({ models, userId, plan, interval, successUrl, cancelUrl }): Promise<{ url }>
 *   createPortal({ models, userId, returnUrl }): Promise<{ url }>
 *   parseWebhook(rawBody, headers): Promise<Normalized | null>
 *       — verifies the signature (throws BillingError on failure), returns null for
 *         events we ignore, else a normalized result:
 *       Normalized = {
 *         userId: string | null,          // from session/subscription metadata
 *         customerId: string | null,      // provider customer id (fallback lookup key)
 *         plan: "free" | "growth" | "pro",
 *         meta: { billingProvider, billingCustomerId, billingSubscriptionId,
 *                 subscriptionStatus, planInterval, planRenewsAt, cancelAtPeriodEnd },
 *       }
 *
 * Each provider owns its own plan→product/price ID mapping (env-driven), so the
 * central PLANS catalog stays provider-agnostic.
 */
const PROVIDERS = { stripe, dodo };

export function getProvider() {
  const key = (process.env.BILLING_PROVIDER || "dodo").toLowerCase();
  return PROVIDERS[key] || dodo;
}
