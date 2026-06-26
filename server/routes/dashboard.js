import express from "express";
import mongoose from "mongoose";

export default function createDashboardRouter(Client, TrackedContact, User, Sequence, Message, SequenceEvent, Activity) {
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
        sequencesRunningCount,
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

        // 3b. Sequences running: sequence definitions currently active (not paused/draft/archived)
        Sequence.countDocuments({ userId, status: "active" }),

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
          sequencesRunning: sequencesRunningCount,
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

  // ─── GET /api/dashboard/activity ───
  // Unified "Recent Activity" feed. Merges three timestamped streams — the Activity
  // log (client CRUD + inventory upload/delete), inbox Messages, and SequenceEvents —
  // then returns the newest 15 across all of them.
  const FEED_LIMIT = 15;

  // Sequence event types worth surfacing (node_entered/branched are too noisy).
  const SEQ_TYPES = [
    "enrolled", "message_sent", "message_failed", "replied",
    "halted", "completed", "goal_met", "failed",
  ];
  const seqLabel = {
    enrolled: "Contact enrolled in a sequence",
    message_sent: "Sequence sent a message",
    message_failed: "Sequence message failed to send",
    replied: "Contact replied to a sequence",
    halted: "Sequence halted",
    completed: "Sequence completed",
    goal_met: "Sequence goal met",
    failed: "Sequence failed",
  };

  router.get("/activity", async (req, res) => {
    try {
      const userId = req.userId;

      // Watermark from a prior "clear": only show items newer than it.
      const user = await User.findById(userId).select("activityClearedAt").lean();
      const clearedAt = user?.activityClearedAt || null;
      const activityFilter = { userId };
      const messageFilter = { userId };
      const seqFilter = { userId, type: { $in: SEQ_TYPES } };
      if (clearedAt) {
        activityFilter.at = { $gt: clearedAt };
        messageFilter.timestamp = { $gt: clearedAt };
        seqFilter.at = { $gt: clearedAt };
      }

      const [activityRows, messageRows, seqRows] = await Promise.all([
        Activity.find(activityFilter)
          .sort({ at: -1 })
          .limit(FEED_LIMIT)
          .lean(),
        Message.find(messageFilter)
          .sort({ timestamp: -1 })
          .limit(FEED_LIMIT)
          .select("direction channel contactName contactIdentifier timestamp")
          .lean(),
        SequenceEvent.find(seqFilter)
          .sort({ at: -1 })
          .limit(FEED_LIMIT)
          .select("type at")
          .lean(),
      ]);

      const items = [];

      // 1. Activity log (client + inventory) — already human-readable.
      for (const a of activityRows) {
        items.push({
          id: String(a._id),
          kind: a.category, // "client" | "inventory"
          title: a.title,
          // Structured field diffs for client updates → rendered as chips.
          changes: Array.isArray(a.meta?.changes) ? a.meta.changes : undefined,
          // Marks actions performed by the AI Copilot so the feed can badge them.
          ai: a.meta?.source === "ai",
          at: a.at,
        });
      }

      // 2. Inbox messages.
      for (const m of messageRows) {
        const who = m.contactName || m.contactIdentifier || "a contact";
        const title =
          m.direction === "inbound"
            ? `New message from ${who} via ${m.channel}`
            : `Sent a message to ${who} via ${m.channel}`;
        items.push({
          id: String(m._id),
          kind: "inbox",
          title,
          at: m.timestamp,
        });
      }

      // 3. Sequence events.
      for (const s of seqRows) {
        items.push({
          id: String(s._id),
          kind: "sequence",
          title: seqLabel[s.type] || "Sequence activity",
          at: s.at,
        });
      }

      // Merge, newest first, cap to FEED_LIMIT.
      items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

      res.json({ items: items.slice(0, FEED_LIMIT) });
    } catch (err) {
      console.error("Error fetching activity feed:", err.message);
      res.status(500).json({ error: "Failed to fetch activity feed." });
    }
  });

  // ─── GET /api/dashboard/weekly ───
  // Stacked-bar data for the "Weekly Activity" chart: counts of activity over the
  // last 7 days, bucketed by calendar day and split by category. Reads the same
  // streams as the feed (client/inventory log, inbox messages, sequence events) but
  // is independent of the feed's "clear" watermark — this is an analytics view.
  const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  router.get("/weekly", async (req, res) => {
    try {
      const userId = req.userId;

      // Start = midnight 6 days ago → 7 buckets including today (local server time).
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 6);

      const [activityRows, messageRows, seqRows] = await Promise.all([
        Activity.find({ userId, at: { $gte: start } }).select("category at").lean(),
        Message.find({ userId, timestamp: { $gte: start } }).select("timestamp").lean(),
        SequenceEvent.find({ userId, type: { $in: SEQ_TYPES }, at: { $gte: start } })
          .select("at").lean(),
      ]);

      // Seed 7 day buckets.
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        days.push({
          label: WEEKDAY[d.getDay()],
          date: d.toISOString(),
          client: 0,
          inventory: 0,
          inbox: 0,
          sequence: 0,
          total: 0,
        });
      }

      const bucketIndex = (dateVal) => {
        const d = new Date(dateVal);
        d.setHours(0, 0, 0, 0);
        const idx = Math.floor((d.getTime() - start.getTime()) / 86400000);
        return idx >= 0 && idx < 7 ? idx : -1;
      };

      const tally = (dateVal, key) => {
        const idx = bucketIndex(dateVal);
        if (idx === -1) return;
        days[idx][key] += 1;
        days[idx].total += 1;
      };

      for (const a of activityRows) {
        tally(a.at, a.category === "inventory" ? "inventory" : "client");
      }
      for (const m of messageRows) tally(m.timestamp, "inbox");
      for (const s of seqRows) tally(s.at, "sequence");

      const max = Math.max(...days.map((d) => d.total), 1);

      res.json({ days, max });
    } catch (err) {
      console.error("Error fetching weekly activity:", err.message);
      res.status(500).json({ error: "Failed to fetch weekly activity." });
    }
  });

  // ─── POST /api/dashboard/activity/clear ───
  // Clears the feed view by advancing the user's watermark to now. Non-destructive:
  // messages and sequence events are untouched; only the feed hides prior items.
  // Activity-log rows (display-only) are pruned to keep the collection lean.
  router.post("/activity/clear", async (req, res) => {
    try {
      const now = new Date();
      await Promise.all([
        User.updateOne({ _id: req.userId }, { $set: { activityClearedAt: now } }),
        Activity.deleteMany({ userId: req.userId, at: { $lte: now } }),
      ]);
      res.json({ success: true });
    } catch (err) {
      console.error("Error clearing activity feed:", err.message);
      res.status(500).json({ error: "Failed to clear activity feed." });
    }
  });

  return router;
}
