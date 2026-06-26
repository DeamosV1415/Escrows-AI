import { getActiveSequenceLimit, getPlanLimit } from "../config/plans.js";

/**
 * Plan active-sequence cap enforcement on downgrade.
 *
 * The cap on how many sequences a user may keep ACTIVE at once is enforced at
 * activation time (the route blocks a new activation past the limit). But a
 * *downgrade* can leave a user already over the new cap. We don't yank their
 * running sequences out from under them: instead the downgrade stamps a grace
 * deadline (`User.planGraceUntil`), the UI nudges them to pause down to the cap,
 * and once the deadline passes this sweep auto-pauses the excess — keeping the
 * most-recently-activated sequences running.
 *
 * Dormant until billing calls `applyPlanChange` on a real downgrade.
 */

const GRACE_DAYS = 2;
export const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Apply a plan change to a user — THE single, authoritative plan mutation. Called
 * only by the billing webhook (Stripe is the source of truth; we never trust the
 * client). Keeps every tier-derived limit in sync in one place:
 *
 *  - `User.plan` (drives storage + active-sequence caps) + the Stripe-status cache
 *    fields (`meta` → planInterval / subscriptionStatus / planRenewsAt / etc.).
 *  - `CreditAccount` (AI copilot credits): tier + monthlyAllocation follow the plan;
 *    an UPGRADE grants the allocation increase immediately, a DOWNGRADE keeps the
 *    current balance and just lowers future monthly refills.
 *  - Active-sequence cap: over the new cap → stamp `planGraceUntil` (the sweep pauses
 *    the excess once it elapses); at/under → clear any stale grace deadline.
 *
 * `models.CreditAccount` is optional so existing callers/tests that only pass
 * { User, Sequence } keep working. Returns a summary for the caller / tests.
 */
export async function applyPlanChange({ User, Sequence, CreditAccount }, userId, newPlan, meta = {}, now = new Date()) {
  const limit = getActiveSequenceLimit(newPlan);
  const activeCount = await Sequence.countDocuments({ userId, status: "active" });

  const over = activeCount > limit;
  const planGraceUntil = over ? new Date(now.getTime() + GRACE_MS) : null;

  // User: plan + grace, plus any billing-status fields the webhook passed through.
  const userSet = { plan: newPlan, planGraceUntil };
  for (const k of ["billingProvider", "billingCustomerId", "billingSubscriptionId", "subscriptionStatus", "planInterval", "planRenewsAt", "cancelAtPeriodEnd"]) {
    if (meta[k] !== undefined) userSet[k] = meta[k];
  }
  await User.updateOne({ _id: userId }, { $set: userSet });

  // CreditAccount: keep AI-credit allocation in lockstep with the plan.
  let creditGrant = 0;
  if (CreditAccount) {
    const newAlloc = getPlanLimit(newPlan, "credits");
    const acct = await CreditAccount.findOne({ userId });
    if (acct) {
      // Only grant the top-up on a genuine tier CHANGE. Webhooks can be re-delivered
      // and non-plan updates (e.g. cancel-at-period-end toggles) re-run this — gating
      // the $inc on an actual tier change keeps the credit grant idempotent.
      const tierChanged = acct.tier !== newPlan;
      const oldAlloc = acct.monthlyAllocation ?? 0;
      creditGrant = tierChanged && newAlloc > oldAlloc ? newAlloc - oldAlloc : 0; // upgrade tops up the increase now
      await CreditAccount.updateOne(
        { userId },
        { $set: { tier: newPlan, monthlyAllocation: newAlloc, unlimited: false }, ...(creditGrant ? { $inc: { credits: creditGrant } } : {}) },
      );
    } else {
      // No account yet (user never used the copilot) → seed one at the new plan.
      await CreditAccount.create({ userId, tier: newPlan, monthlyAllocation: newAlloc, credits: newAlloc, unlimited: false, lastRefill: now });
    }
  }

  return { plan: newPlan, limit, activeCount, over, planGraceUntil, creditGrant };
}

/**
 * Auto-pause the excess for every user whose grace window has elapsed and who is
 * still over their plan's cap. Keeps the `limit` most-recently-activated sequences
 * active, pauses the rest, notifies the user, and clears the grace deadline.
 *
 * Safe to call every tick: it only touches users with a *past* `planGraceUntil`,
 * and clears it as the last step so each downgrade is enforced exactly once.
 * Returns per-user results (handy for tests/logging).
 */
export async function sweepActiveSequenceCaps({ User, Sequence, Notification }, now = new Date()) {
  const due = await User.find({ planGraceUntil: { $ne: null, $lte: now } })
    .select("plan planGraceUntil")
    .lean();

  const results = [];
  for (const u of due) {
    const limit = getActiveSequenceLimit(u.plan);

    // Most-recently-activated first; nulls (legacy, pre-activatedAt) sink to the
    // bottom via createdAt so they're the first paused.
    const active = await Sequence.find({ userId: u._id, status: "active" })
      .select("name activatedAt")
      .sort({ activatedAt: -1, createdAt: -1 })
      .lean();

    const toPause = active.slice(limit); // everything beyond the cap
    if (toPause.length) {
      const ids = toPause.map((s) => s._id);
      await Sequence.updateMany({ _id: { $in: ids } }, { $set: { status: "paused" } });

      if (Notification) {
        await Notification.create({
          userId: u._id,
          source: "sequence",
          title: "Sequences paused to fit your plan",
          message: `Your plan allows ${limit} active sequence${limit === 1 ? "" : "s"}. We paused ${toPause.length} to fit: ${toPause.map((s) => s.name).join(", ")}. Reactivate any of them after freeing a slot.`,
          priority: "high",
        });
      }
    }

    await User.updateOne({ _id: u._id }, { $set: { planGraceUntil: null } });
    results.push({ userId: u._id, limit, pausedCount: toPause.length, pausedIds: toPause.map((s) => s._id) });
  }
  return results;
}
