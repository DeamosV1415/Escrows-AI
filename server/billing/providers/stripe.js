import Stripe from "stripe";
import { BillingError } from "../errors.js";

/**
 * Stripe billing provider. Implements the provider contract (see providers/index.js).
 * Owns its own plan+interval → Stripe Price ID mapping (env-driven) so the central
 * PLANS catalog stays provider-agnostic.
 */

const PRICE_ENV = {
  growth: { month: "STRIPE_PRICE_GROWTH_MONTH", year: "STRIPE_PRICE_GROWTH_YEAR" },
  pro: { month: "STRIPE_PRICE_PRO_MONTH", year: "STRIPE_PRICE_PRO_YEAR" },
};
const priceId = (plan, interval) => process.env[PRICE_ENV[plan]?.[interval]] || null;
function planFromPriceId(id) {
  for (const plan of Object.keys(PRICE_ENV)) {
    for (const interval of ["month", "year"]) {
      if (id && priceId(plan, interval) === id) return { plan, interval };
    }
  }
  return null;
}

let _stripe = null;
function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
      appInfo: { name: "Escrows AI" },
    });
  }
  return _stripe;
}

export const name = "stripe";

export function isConfigured() {
  return !!process.env.STRIPE_SECRET_KEY;
}

async function getOrCreateCustomer(models, userId) {
  const user = await models.User.findById(userId).select("email name billingProvider billingCustomerId").lean();
  if (!user) throw new BillingError("User not found", 404);
  if (user.billingCustomerId && user.billingProvider === "stripe") return user.billingCustomerId;

  const customer = await stripe().customers.create({
    email: user.email,
    name: user.name || undefined,
    metadata: { userId: String(userId) },
  });
  await models.User.updateOne({ _id: userId }, { $set: { billingProvider: "stripe", billingCustomerId: customer.id } });
  return customer.id;
}

export async function createCheckout({ models, userId, plan, interval, successUrl, cancelUrl }) {
  const id = priceId(plan, interval);
  if (!id) throw new BillingError(`Billing isn't configured for the ${plan} (${interval}) plan yet.`, 503);

  const customer = await getOrCreateCustomer(models, userId);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: id, quantity: 1 }],
    client_reference_id: String(userId),
    subscription_data: { metadata: { userId: String(userId), plan } },
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return { url: session.url };
}

export async function createPortal({ models, userId, returnUrl }) {
  const user = await models.User.findById(userId).select("billingCustomerId").lean();
  if (!user?.billingCustomerId) throw new BillingError("No billing account yet — subscribe to a paid plan first.", 400);

  const session = await stripe().billingPortal.sessions.create({
    customer: user.billingCustomerId,
    return_url: returnUrl,
  });
  return { url: session.url };
}

const ENDED = ["canceled", "unpaid", "incomplete_expired"];

function normalize(sub) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const item = sub.items?.data?.[0];
  const mapped = item ? planFromPriceId(item.price?.id) : null;
  const ended = ENDED.includes(sub.status) || !mapped;

  return {
    userId: sub.metadata?.userId || null,
    customerId: customerId || null,
    plan: ended ? "free" : mapped.plan,
    meta: {
      billingProvider: "stripe",
      billingCustomerId: customerId || undefined,
      billingSubscriptionId: ended ? null : sub.id,
      subscriptionStatus: ended ? "canceled" : sub.status,
      planInterval: ended ? null : mapped.interval,
      planRenewsAt: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    },
  };
}

export async function parseWebhook(rawBody, headers) {
  const s = stripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s || !secret) return null;

  let event;
  try {
    event = s.webhooks.constructEvent(rawBody, headers["stripe-signature"], secret);
  } catch (err) {
    throw new BillingError(`Webhook signature verification failed: ${err.message}`, 400);
  }

  let sub = null;
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.mode === "subscription" && session.subscription) {
      sub = await s.subscriptions.retrieve(session.subscription);
      if (!sub.metadata?.userId && (session.metadata?.userId || session.client_reference_id)) {
        sub.metadata = { ...sub.metadata, userId: session.metadata?.userId || session.client_reference_id };
      }
    }
  } else if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    sub = event.data.object;
  }

  return sub ? normalize(sub) : null;
}
