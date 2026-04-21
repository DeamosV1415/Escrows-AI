import express from "express";
import mongoose from "mongoose";

export default function createDashboardRouter(Client, TrackedContact, User) {
  const router = express.Router();

  // ─── GET /api/dashboard ───
  // Returns aggregated dashboard data for the logged-in user
  router.get("/", async (req, res) => {
    try {
      const userId = req.userId;
      const userObjId = new mongoose.Types.ObjectId(userId);

      // Run all queries in parallel
      const [
        activeLeadsCount,
        hotLeadsCount,
        trackedContactsCount,
        hotLeadsList,
        nextActionsRaw,
        pipelineRaw,
        user,
      ] = await Promise.all([
        // 1. Active leads: stage ≠ "Closed"
        Client.countDocuments({ userId, stage: { $ne: "Closed" } }),

        // 2. Hot leads count
        Client.countDocuments({ userId, intent: "hot" }),

        // 3. Tracked contacts count
        TrackedContact.countDocuments({ userId }),

        // 4. Hot leads list (top 5, sorted by most recently updated)
        Client.find({ userId, intent: "hot" })
          .sort({ updatedAt: -1 })
          .limit(5)
          .select("name company budget nextAction updatedAt")
          .lean(),

        // 5. Next actions list (clients with non-empty nextAction)
        Client.find({ userId, nextAction: { $nin: ["", null] } })
          .sort({ updatedAt: -1 })
          .limit(10)
          .select("name nextAction nextActionPriority updatedAt")
          .lean(),

        // 6. Pipeline counts grouped by stage
        Client.aggregate([
          { $match: { userId: userObjId } },
          { $group: { _id: "$stage", count: { $sum: 1 } } },
        ]),

        // 7. User info (for welcome message)
        User.findById(userId).select("name").lean(),
      ]);

      // Sort next actions: high → medium → low
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const nextActionsList = nextActionsRaw
        .sort(
          (a, b) =>
            (priorityOrder[a.nextActionPriority] ?? 1) -
            (priorityOrder[b.nextActionPriority] ?? 1)
        )
        .slice(0, 6);

      // Build pipeline with all stages
      const stages = ["Lead", "Engaged", "Under Contract", "Closed"];
      const pipeline = stages.map((stage) => {
        const found = pipelineRaw.find((r) => r._id === stage);
        return { stage, count: found ? found.count : 0 };
      });

      res.json({
        stats: {
          activeLeads: activeLeadsCount,
          hotLeads: hotLeadsCount,
          trackedContacts: trackedContactsCount,
        },
        hotLeadsList,
        nextActionsList,
        pipeline,
        userName: user?.name || "there",
      });
    } catch (err) {
      console.error("Error fetching dashboard data:", err.message);
      res.status(500).json({ error: "Failed to fetch dashboard data." });
    }
  });

  return router;
}
