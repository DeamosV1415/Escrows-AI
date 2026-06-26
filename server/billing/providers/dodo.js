import DodoPayments from "dodopayments";
import { BillingError } from "../errors.js";

/**
 * Dodo Payments provider (Merchant of Record). Implements the provider contract
 * (see providers/index.js). Owns its own plan+interval → Dodo Product ID mapping
 * (env-driven). Uses Dodo Checkout Sessions for subscribe, the Customer Portal for
 * self-service, and Standard-Webhooks signature verification.
 */

const PRODUCT_ENV = {
  growth: { month: "DODO_PRODUCT_GROWTH_MONTH", year: "DODO_PRODUCT_GROWTH_YEAR" },
  pro: { month: "DODO_PRODUCT_PRO_MONTH", year: "DODO_PRODUCT_PRO_YEAR" },
};
const productId = (plan, interval) => process.env[PRODUCT_ENV[plan]?.[interval]] || null;
function planFromProductId(id) {
  for (const plan of Object.keys(PRODUCT_ENV)) {
    for (const interval of ["month", "year"]) {
      if (id && productId(plan, interval) === id) return { plan, interval };
    }
  }
  return null;
}

let _client = null;
function client() {
  if (!process.env.DODO_API_KEY) return null;
  if (!_client) {
    _client = new DodoPayments({
      bearerToken: process.env.DODO_API_KEY,
      environment: process.env.DODO_ENVIRONMENT || "test_mode", // "test_mode" | "live_mode"
    });
  }
  return _client;
}

export const name = "dodo";

export function isConfigured() {
  return !!process.env.DODO_API_KEY;
}

export async function createCheckout({ models, userId, plan, interval, successUrl }) {
  const pid = productId(plan, interval);
  if (!pid) throw new BillingError(`Billing isn't configured for the ${plan} (${interval}) plan yet.`, 503);

  const user = await models.User.findById(userId).select("email name billingProvider billingCustomerId").lean();
  if (!user) throw new BillingError("User not found", 404);

  // Reuse the Dodo customer if we already have one; otherwise let Dodo create/attach
  // by email. Either way we stamp userId on the session metadata so the webhook can
  // resolve the user. (Dodo has no separate cancel_url — return_url is post-payment.)
  const customer =
    user.billingCustomerId && user.billingProvider === "dodo"
      ? { customer_id: user.billingCustomerId }
      : { email: user.email, name: user.name || user.email };

  const session = await client().checkoutSessions.create({
    product_cart: [{ product_id: pid, quantity: 1 }],
    customer,
    return_url: successUrl,
    metadata: { userId: String(userId), plan },
  });
  return { url: session.checkout_url };
}

export async function createPortal({ models, userId, returnUrl }) {
  const user = await models.User.findById(userId).select("billingCustomerId").lean();
  if (!user?.billingCustomerId) throw new BillingError("No billing account yet — subscribe to a paid plan first.", 400);

  const session = await client().customers.customerPortal.create(user.billingCustomerId, {
    return_url: returnUrl,
    send_email: false,
  });
  return { url: session.link };
}

// Dodo subscription statuses → our normalized status / plan handling.
//  active/renewed/plan_changed/updated → keep the paid plan, status active.
//  on_hold / failed                    → dunning: keep plan, status past_due.
//  cancelled / expired                 → ended: revert to Free.
const ENDED = ["cancelled", "expired"];
const PAST_DUE = ["on_hold", "failed"];

export function normalize(data) {
  const status = data.status;
  const mapped = planFromProductId(data.product_id);
  const ended = ENDED.includes(status) || !mapped;
  const customerId = data.customer?.customer_id || data.customer_id || null;

  let normStatus = "active";
  if (ended) normStatus = "canceled";
  else if (PAST_DUE.includes(status)) normStatus = "past_due";
  else if (status === "pending") normStatus = "incomplete";

  return {
    userId: data.metadata?.userId || null,
    customerId,
    plan: ended ? "free" : mapped.plan,
    meta: {
      billingProvider: "dodo",
      billingCustomerId: customerId || undefined,
      billingSubscriptionId: ended ? null : data.subscription_id,
      subscriptionStatus: normStatus,
      planInterval: ended ? null : mapped.interval,
      planRenewsAt: data.next_billing_date ? new Date(data.next_billing_date) : null,
      cancelAtPeriodEnd: !!data.cancel_at_next_billing_date,
    },
  };
}

export async function parseWebhook(rawBody, headers) {
  const c = client();
  const key = process.env.DODO_WEBHOOK_KEY;
  if (!c || !key) return null;

  let event;
  try {
    event = c.webhooks.unwrap(rawBody.toString(), {
      headers: {
        "webhook-id": headers["webhook-id"],
        "webhook-signature": headers["webhook-signature"],
        "webhook-timestamp": headers["webhook-timestamp"],
      },
      key,
    });
  } catch (err) {
    throw new BillingError(`Webhook signature verification failed: ${err.message}`, 400);
  }

  // Only subscription lifecycle events drive plan state; ignore payment.*/refund.* etc.
  if (!event?.type?.startsWith("subscription.")) return null;
  return normalize(event.data || {});
}
