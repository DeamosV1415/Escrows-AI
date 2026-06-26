import { z } from "zod";
import mongoose from "mongoose";

export default function registerDashboardTools(registry, { Client, TrackedContact, User }) {

  registry.register({
    category: "dashboard",
    name: "get_dashboard_summary",
    description: "One-shot dashboard summary: active leads count, hot leads count, tracked contacts, top hot leads, prioritised next actions, and pipeline counts by stage.",
    creditCost: 1,
    sensitive: false,
    schema: z.object({}),
    handler: async (_a, userId) => {
      const uid = new mongoose.Types.ObjectId(userId);

      const [
        activeLeads, hotLeads, trackedContacts,
        hotLeadsList, nextActionsRaw, pipelineRaw, user,
      ] = await Promise.all([
        Client.countDocuments({ userId, stage: { $ne: "Closed" } }),
        Client.countDocuments({ userId, intent: "hot" }),
        TrackedContact.countDocuments({ userId }),
        Client.find({ userId, intent: "hot" })
          .sort({ updatedAt: -1 }).limit(5)
          .select("name company budget nextAction updatedAt").lean(),
        Client.find({ userId, nextAction: { $nin: ["", null] } })
          .sort({ updatedAt: -1 }).limit(10)
          .select("name nextAction nextActionPriority updatedAt").lean(),
        Client.aggregate([
          { $match: { userId: uid } },
          { $group: { _id: "$stage", count: { $sum: 1 } } },
        ]),
        User.findById(userId).select("name").lean(),
      ]);

      const order = { high: 0, medium: 1, low: 2 };
      const nextActions = nextActionsRaw
        .sort((a, b) => (order[a.nextActionPriority] ?? 1) - (order[b.nextActionPriority] ?? 1))
        .slice(0, 6)
        .map((a) => ({ name: a.name, action: a.nextAction, priority: a.nextActionPriority }));

      const stages = ["Lead", "Engaged", "Under Contract", "Closed"];
      const pipeline = stages.map((stage) => {
        const found = pipelineRaw.find((r) => r._id === stage);
        return { stage, count: found ? found.count : 0 };
      });

      return {
        userName: user?.name || "there",
        stats: { activeLeads, hotLeads, trackedContacts },
        hotLeads: hotLeadsList.map((l) => ({
          name: l.name, company: l.company, budget: l.budget, nextAction: l.nextAction,
        })),
        nextActions,
        pipeline,
      };
    },
  });
}
