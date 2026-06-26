import express from "express";
import {
  isBillingConfigured,
  createCheckoutSession,
  createPortalSession,
  billingSummary,
  BillingError,
} from "../billing/billingService.js";
import { PLANS } from "../config/plans.js";

/**
 * Billing routes (authed), provider-agnostic. Webhook handling lives in index.js
 * (it needs the raw body for signature verification, so it can't sit behind
 * express.json()).
 *
 * `models` is the full bag — billingService needs { User, Sequence, CreditAccount }.
 */
export default function createBillingRouter(models) {
  const router = express.Router();

  // Resolve the app base URL for provider redirect targets (success/cancel/return).
  const baseUrl = (req) =>
    process.env.APP_URL || req.get("origin") || `${req.protocol}://${req.get("host")}`;

  const ensureConfigured = (res) => {
    if (!isBillingConfigured()) {
      res.status(503).json({ error: "Billing isn't configured on this server yet." });
      return false;
    }
    return true;
  };

  // ─── GET /api/billing/me — current plan + status for the Settings UI ───
  router.get("/me", async (req, res) => {
    try {
      const user = await models.User.findById(req.userId)
        .select("plan planInterval subscriptionStatus planRenewsAt cancelAtPeriodEnd billingCustomerId")
        .lean();
      res.json({ ...billingSummary(user), billingConfigured: isBillingConfigured() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── GET /api/billing/plans — public catalog (numbers the UI gates against) ───
  router.get("/plans", (_req, res) => {
    const plans = Object.values(PLANS).map((p) => ({
      id: p.id,
      label: p.label,
      price: p.price,
      credits: p.credits,
      storageMB: p.storageMB,
      activeSequences: p.activeSequences,
      callSummaries: p.callSummaries,
      dealSignals: p.dealSignals,
    }));
    res.json({ plans });
  });

  // ─── POST /api/billing/checkout — start a subscription (onboarding / upgrade) ───
  // body: { plan: "growth"|"pro", interval: "month"|"year", context?: "onboarding"|"settings" }
  // `context` decides the return URLs server-side (no client-supplied redirects → no open-redirect).
  router.post("/checkout", async (req, res) => {
    if (!ensureConfigured(res)) return;
    try {
      const { plan, interval = "month", context = "settings" } = req.body || {};
      const root = baseUrl(req);
      const onboarding = context === "onboarding";
      const { url } = await createCheckoutSession(models, req.userId, plan, interval, {
        successUrl: onboarding
          ? `${root}/onboarding?checkout=success&step=2`
          : `${root}/dashboard/settings?billing=success#billing`,
        cancelUrl: onboarding
          ? `${root}/onboarding?checkout=cancelled&step=1`
          : `${root}/dashboard/settings?billing=cancelled#billing`,
      });
      res.json({ url });
    } catch (err) {
      const status = err instanceof BillingError ? err.status : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // ─── POST /api/billing/portal — open the provider's self-service portal ───
  router.post("/portal", async (req, res) => {
    if (!ensureConfigured(res)) return;
    try {
      const root = baseUrl(req);
      const { url } = await createPortalSession(models, req.userId, `${root}/dashboard/settings#billing`);
      res.json({ url });
    } catch (err) {
      const status = err instanceof BillingError ? err.status : 500;
      res.status(status).json({ error: err.message });
    }
  });

  return router;
}
