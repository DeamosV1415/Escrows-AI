import { PLANS } from "../config/plans.js";

// Credit tiers derive from the central PLANS catalog so allocations can never drift
// from the rest of a plan's limits. `enterprise` is the one exception — a custom,
// unlimited tier set by admins, not part of the public pricing catalog.
const fromPlan = (id) => ({
  monthlyAllocation: PLANS[id].credits,
  unlimited: false,
  label: PLANS[id].label,
  price: PLANS[id].price.month === 0 ? "$0/mo" : `$${PLANS[id].price.month}/mo`,
});

const TIERS = {
  free: fromPlan("free"),
  growth: fromPlan("growth"),
  pro: fromPlan("pro"),
  enterprise: { monthlyAllocation: 0, unlimited: true, label: "Enterprise", price: "Custom" },
};

function tierConfig(tier) {
  return TIERS[tier] || TIERS.free;
}

function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export async function getOrCreateAccount(CreditAccount, userId) {
  let account = await CreditAccount.findOne({ userId });
  if (!account) {
    const cfg = tierConfig("free");
    account = await CreditAccount.create({
      userId,
      tier: "free",
      credits: cfg.monthlyAllocation,
      monthlyAllocation: cfg.monthlyAllocation,
      unlimited: cfg.unlimited,
      lastRefill: new Date(),
    });
  }
  return account;
}

export async function ensureMonthlyRefill(CreditAccount, userId) {
  const account = await getOrCreateAccount(CreditAccount, userId);
  if (account.unlimited) return account;

  const now = new Date();
  const last = account.lastRefill || account.createdAt || now;
  if (monthsBetween(last, now) < 1) return account;

  const cfg = tierConfig(account.tier);
  const refilled = await CreditAccount.findOneAndUpdate(
    { _id: account._id, lastRefill: account.lastRefill },
    {
      $set: {
        credits: cfg.monthlyAllocation,
        monthlyAllocation: cfg.monthlyAllocation,
        unlimited: cfg.unlimited,
        lastRefill: now,
      },
    },
    { new: true },
  );
  return refilled || account;
}

export async function getBalanceInfo(CreditAccount, userId) {
  const account = await ensureMonthlyRefill(CreditAccount, userId);
  const cfg = tierConfig(account.tier);
  return {
    tier: account.tier,
    tierLabel: cfg.label,
    price: cfg.price,
    credits: account.unlimited ? Infinity : account.credits,
    creditsDisplay: account.unlimited ? "Unlimited" : String(account.credits),
    monthlyAllocation: account.monthlyAllocation,
    unlimited: !!account.unlimited,
    totalUsed: account.totalUsed || 0,
    lastRefill: account.lastRefill,
  };
}

export async function hasCredits(CreditAccount, userId, cost) {
  const account = await ensureMonthlyRefill(CreditAccount, userId);
  if (account.unlimited) return { ok: true, balance: Infinity };
  return { ok: account.credits >= cost, balance: account.credits };
}

export async function tryDebit(CreditAccount, userId, toolName, cost) {
  const account = await ensureMonthlyRefill(CreditAccount, userId);

  if (account.unlimited) {
    await CreditAccount.updateOne(
      { _id: account._id },
      {
        $inc: { totalUsed: cost },
        $push: {
          history: {
            $each: [{ toolName, cost, timestamp: new Date() }],
            $slice: -100,
          },
        },
      },
    );
    return { ok: true, balance: Infinity, deducted: cost };
  }

  const updated = await CreditAccount.findOneAndUpdate(
    { userId, credits: { $gte: cost } },
    {
      $inc: { credits: -cost, totalUsed: cost },
      $push: {
        history: {
          $each: [{ toolName, cost, timestamp: new Date() }],
          $slice: -100,
        },
      },
    },
    { new: true },
  );

  if (!updated) {
    const fresh = await CreditAccount.findOne({ userId }).select("credits").lean();
    return { ok: false, balance: fresh?.credits ?? 0, deducted: 0 };
  }
  return { ok: true, balance: updated.credits, deducted: cost };
}

export function upgradePromptText(currentTier) {
  const lines = [
    `You're on the **${tierConfig(currentTier).label}** plan and you've used this month's AI credits.`,
    "",
    "Upgrade to keep going:",
    `- **Growth** — ${TIERS.growth.price} → ${TIERS.growth.monthlyAllocation} credits/mo`,
    `- **Pro** — ${TIERS.pro.price} → ${TIERS.pro.monthlyAllocation} credits/mo`,
    `- **Enterprise** — ${TIERS.enterprise.price} → unlimited`,
  ];
  return lines.join("\n");
}

export { TIERS, tierConfig };
