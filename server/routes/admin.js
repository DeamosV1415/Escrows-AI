import express from "express";

/**
 * Tier → default credit allocations.
 * Used when changing a user's tier to auto-update their allocation,
 * and to cap manual credit edits.
 */
const TIER_DEFAULTS = {
  free: { monthlyAllocation: 40, credits: 40 },
  growth: { monthlyAllocation: 200, credits: 200 },
  pro: { monthlyAllocation: 500, credits: 500 },
  enterprise: { monthlyAllocation: 2000, credits: 2000 },
};

export default function createAdminRouter(User, CreditAccount) {
  const router = express.Router();

  // ─── GET /api/admin/verify ───
  // Lightweight check — if the admin middleware passed, user is admin
  router.get("/verify", (req, res) => {
    res.json({ admin: true, email: req.adminEmail });
  });

  // ─── GET /api/admin/stats ───
  // Aggregate stats for the overview cards
  router.get("/stats", async (req, res) => {
    try {
      const [totalUsers, tierCounts, creditAgg] = await Promise.all([
        User.countDocuments(),
        CreditAccount.aggregate([
          { $group: { _id: "$tier", count: { $sum: 1 } } },
        ]),
        CreditAccount.aggregate([
          {
            $group: {
              _id: null,
              totalUsed: { $sum: "$totalUsed" },
              totalCredits: { $sum: "$credits" },
              totalAllocation: { $sum: "$monthlyAllocation" },
            },
          },
        ]),
      ]);

      const tiers = { free: 0, growth: 0, pro: 0, enterprise: 0 };
      for (const t of tierCounts) {
        if (tiers.hasOwnProperty(t._id)) tiers[t._id] = t.count;
      }

      const cAgg = creditAgg[0] || {
        totalUsed: 0,
        totalCredits: 0,
        totalAllocation: 0,
      };

      res.json({
        totalUsers,
        tiers,
        totalCreditsUsed: cAgg.totalUsed,
        totalCreditsRemaining: cAgg.totalCredits,
        totalMonthlyAllocation: cAgg.totalAllocation,
      });
    } catch (err) {
      console.error("Admin stats error:", err.message);
      res.status(500).json({ error: "Failed to fetch admin stats." });
    }
  });

  // ─── GET /api/admin/users ───
  // Fetch all users with their credit accounts joined
  router.get("/users", async (req, res) => {
    try {
      const users = await User.find()
        .select("-password")
        .sort({ createdAt: -1 })
        .lean();

      // Fetch all credit accounts in one query
      const creditAccounts = await CreditAccount.find().lean();
      const creditMap = new Map();
      for (const ca of creditAccounts) {
        creditMap.set(ca.userId.toString(), ca);
      }

      // Merge user + credit data
      const enriched = users.map((u) => {
        const ca = creditMap.get(u._id.toString());
        return {
          _id: u._id,
          name: u.name,
          email: u.email,
          avatar: u.avatar,
          profileComplete: u.profileComplete,
          phone: u.phone,
          company: u.company,
          jobTitle: u.jobTitle,
          licenseNumber: u.licenseNumber,
          location: u.location,
          specialization: u.specialization,
          teamSize: u.teamSize,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
          // Credit account fields
          tier: ca?.tier || "free",
          credits: ca?.credits ?? 0,
          monthlyAllocation: ca?.monthlyAllocation ?? 0,
          unlimited: ca?.unlimited ?? false,
          totalUsed: ca?.totalUsed ?? 0,
          lastRefill: ca?.lastRefill,
          hasCreditAccount: !!ca,
        };
      });

      res.json({ users: enriched });
    } catch (err) {
      console.error("Admin users error:", err.message);
      res.status(500).json({ error: "Failed to fetch users." });
    }
  });

  // ─── PATCH /api/admin/users/:id ───
  // Update a user's tier/credits/allocation/unlimited
  router.patch("/users/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { tier, credits, monthlyAllocation, unlimited } = req.body;

      // Validate user exists
      const user = await User.findById(id).select("name email").lean();
      if (!user) {
        return res.status(404).json({ error: "User not found." });
      }

      // Build the update object
      const update = {};
      const changes = [];

      if (tier !== undefined) {
        const validTiers = ["free", "growth", "pro", "enterprise"];
        if (!validTiers.includes(tier)) {
          return res
            .status(400)
            .json({ error: `Invalid tier. Must be one of: ${validTiers.join(", ")}` });
        }
        update.tier = tier;
        changes.push(`tier → ${tier}`);

        // Auto-update allocation and credits when tier changes
        const defaults = TIER_DEFAULTS[tier];
        if (defaults) {
          update.monthlyAllocation = defaults.monthlyAllocation;
          update.credits = defaults.credits;
          changes.push(
            `monthlyAllocation → ${defaults.monthlyAllocation}`,
            `credits → ${defaults.credits}`
          );
        }
      }

      // Individual credit edit (overrides tier auto-set if both are sent)
      if (credits !== undefined) {
        const numCredits = Number(credits);
        if (isNaN(numCredits) || numCredits < 0) {
          return res
            .status(400)
            .json({ error: "Credits must be a non-negative number." });
        }

        // Cap credits by the tier's monthly allocation
        const effectiveTier = update.tier || (await getCreditTier(CreditAccount, id));
        const tierMax = TIER_DEFAULTS[effectiveTier]?.monthlyAllocation ?? 40;

        if (numCredits > tierMax) {
          return res.status(400).json({
            error: `Credits cannot exceed ${tierMax} for the "${effectiveTier}" tier.`,
          });
        }

        update.credits = numCredits;
        // Remove the auto-set from tier change if individual credits are specified
        changes.push(`credits → ${numCredits}`);
      }

      if (monthlyAllocation !== undefined) {
        const numAlloc = Number(monthlyAllocation);
        if (isNaN(numAlloc) || numAlloc < 0) {
          return res
            .status(400)
            .json({ error: "Monthly allocation must be a non-negative number." });
        }
        update.monthlyAllocation = numAlloc;
        changes.push(`monthlyAllocation → ${numAlloc}`);
      }

      if (unlimited !== undefined) {
        update.unlimited = Boolean(unlimited);
        changes.push(`unlimited → ${unlimited}`);
      }

      if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: "No valid fields to update." });
      }

      // Upsert — create credit account if it doesn't exist
      const updatedAccount = await CreditAccount.findOneAndUpdate(
        { userId: id },
        { $set: update },
        { returnDocument: "after", upsert: true }
      );

      console.log(
        `🛡️ [Admin] ${req.adminEmail} updated ${user.name} <${user.email}>: ${changes.join(", ")}`
      );

      res.json({
        success: true,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          tier: updatedAccount.tier,
          credits: updatedAccount.credits,
          monthlyAllocation: updatedAccount.monthlyAllocation,
          unlimited: updatedAccount.unlimited,
          totalUsed: updatedAccount.totalUsed,
        },
      });
    } catch (err) {
      console.error("Admin user update error:", err.message);
      res.status(500).json({ error: "Failed to update user." });
    }
  });

  return router;
}

// Helper to get user's current tier
async function getCreditTier(CreditAccount, userId) {
  const ca = await CreditAccount.findOne({ userId }).select("tier").lean();
  return ca?.tier || "free";
}
