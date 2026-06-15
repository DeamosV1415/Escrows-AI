import express from "express";
import mongoose from "mongoose";
import registry from "../sequences/blocks/index.js";
import { validateGraph } from "../sequences/validator.js";
import { dryRun as engineDryRun, wakeAwaitingDocument } from "../sequences/engine.js";
import { enrollManual } from "../sequences/triggers.js";
import { TEMPLATES, getTemplate, triggerOf } from "../sequences/templates.js";

/**
 * REST API for the Sequences module (mounted under authMiddleware). Factory pattern,
 * consistent with the other routers. Every write that touches a graph runs the shared
 * validator first — an invalid graph can never persist or activate.
 *
 * The secret-gated POST /tick lives in index.js (registered before this router so it
 * stays exempt from JWT auth).
 */
export default function createSequencesRouter(models) {
  const router = express.Router();
  const { Sequence, SequenceEnrollment, SequenceEvent, SequenceSettings, Notification, Client, DocumentRequest } = models;

  const oid = (id) => mongoose.isValidObjectId(id);

  // A starter graph for a blank sequence: manual trigger straight to an end.
  function blankGraph() {
    return {
      nodes: [
        { id: "trigger", type: "manual_enroll", family: "trigger", config: {}, position: { x: 240, y: 80 } },
        { id: "end", type: "end", family: "exit", config: {}, position: { x: 240, y: 260 } },
      ],
      edges: [{ id: "trigger__out__end", source: "trigger", target: "end", handle: "out" }],
    };
  }

  /* ───────────────────────── static routes (declared before /:id) ───────────────────────── */

  // Block catalog for the canvas palette.
  router.get("/blocks", (req, res) => {
    res.json({ blocks: registry.toCatalog() });
  });

  // Built-in templates (library cards).
  router.get("/templates", (req, res) => {
    res.json({
      templates: TEMPLATES.map((t) => ({
        key: t.key,
        name: t.name,
        description: t.description,
        triggerType: triggerOf(t.graph).triggerType,
        nodeCount: t.graph.nodes.length,
      })),
    });
  });

  // In-app notifications (the notify_broker / digest sink).
  router.get("/notifications", async (req, res) => {
    try {
      const { unreadOnly } = req.query;
      const filter = { userId: req.userId };
      if (unreadOnly === "true") filter.read = false;
      const items = await Notification.find(filter).sort({ createdAt: -1 }).limit(100).lean();
      const unread = await Notification.countDocuments({ userId: req.userId, read: false });
      res.json({ notifications: items, unread });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch("/notifications/:id/read", async (req, res) => {
    try {
      await Notification.updateOne({ _id: req.params.id, userId: req.userId }, { $set: { read: true } });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/notifications/read-all", async (req, res) => {
    try {
      await Notification.updateMany({ userId: req.userId, read: false }, { $set: { read: true } });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Per-broker settings (kill switch + timezone + quiet hours). The frontend posts the
  // browser's detected timezone here so the engine evaluates quiet hours in the broker's
  // local time rather than UTC.
  router.get("/settings", async (req, res) => {
    try {
      const s = await SequenceSettings.findOne({ userId: req.userId }).lean();
      res.json({
        killSwitch: !!s?.killSwitch,
        defaultTimezone: s?.defaultTimezone || "UTC",
        defaultQuietHours: s?.defaultQuietHours || { start: "21:00", end: "08:00" },
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/settings", async (req, res) => {
    try {
      const $set = {};
      const { defaultTimezone, defaultQuietHours } = req.body;
      // Accept a timezone only if it's a real IANA zone the runtime understands.
      if (typeof defaultTimezone === "string" && defaultTimezone) {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: defaultTimezone });
          $set.defaultTimezone = defaultTimezone;
        } catch { /* ignore an invalid zone */ }
      }
      if (defaultQuietHours?.start && defaultQuietHours?.end) {
        $set.defaultQuietHours = { start: defaultQuietHours.start, end: defaultQuietHours.end };
      }
      if (!Object.keys($set).length) return res.json({ success: true, unchanged: true });
      const s = await SequenceSettings.findOneAndUpdate(
        { userId: req.userId },
        { $set },
        { upsert: true, returnDocument: "after" },
      ).lean();
      res.json({ success: true, settings: { defaultTimezone: s.defaultTimezone, defaultQuietHours: s.defaultQuietHours } });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Per-broker kill switch.
  router.get("/kill-switch", async (req, res) => {
    const s = await SequenceSettings.findOne({ userId: req.userId }).select("killSwitch").lean();
    res.json({ enabled: !!s?.killSwitch });
  });

  router.post("/kill-switch", async (req, res) => {
    try {
      const enabled = !!req.body.enabled;
      await SequenceSettings.updateOne(
        { userId: req.userId },
        { $set: { killSwitch: enabled } },
        { upsert: true },
      );
      res.json({ success: true, enabled });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Cross-sequence analytics aggregated from the event stream.
  router.get("/analytics", async (req, res) => {
    try {
      const userId = new mongoose.Types.ObjectId(req.userId);
      const [rows, haltRows, activeRows] = await Promise.all([
        SequenceEvent.aggregate([
          { $match: { userId } },
          { $group: { _id: { sequenceId: "$sequenceId", type: "$type" }, n: { $sum: 1 } } },
        ]),
        // Halt/failure reasons for the drop-off breakdown.
        SequenceEvent.aggregate([
          { $match: { userId, type: { $in: ["halted", "failed"] } } },
          { $group: { _id: { sequenceId: "$sequenceId", reason: "$meta.reason" }, n: { $sum: 1 } } },
        ]),
        // Live count of who is CURRENTLY enrolled (counted from enrollments, not the event
        // stream, so unenrolls/completions are reflected immediately and it can't drift).
        SequenceEnrollment.aggregate([
          { $match: { userId, status: { $in: ["active", "running"] } } },
          { $group: { _id: "$sequenceId", n: { $sum: 1 } } },
        ]),
      ]);
      const bySeq = {};
      for (const r of rows) {
        const sid = String(r._id.sequenceId);
        (bySeq[sid] ||= {})[r._id.type] = r.n;
      }
      const reasonsBySeq = {};
      for (const r of haltRows) {
        const sid = String(r._id.sequenceId);
        (reasonsBySeq[sid] ||= {})[r._id.reason || "unknown"] = r.n;
      }
      const activeBySeq = {};
      for (const r of activeRows) activeBySeq[String(r._id)] = r.n;

      const seqs = await Sequence.find({ userId: req.userId }).select("name status stats").lean();
      const analytics = seqs.map((s) => {
        const ev = bySeq[String(s._id)] || {};
        const enrolled = ev.enrolled || 0;
        const replied = ev.replied || 0;
        const goal = ev.goal_met || 0;
        return {
          sequenceId: s._id,
          name: s.name,
          status: s.status,
          stats: s.stats,
          activeNow: activeBySeq[String(s._id)] || 0,
          funnel: {
            enrolled,
            messagesSent: ev.message_sent || 0,
            replied,
            completed: ev.completed || 0,
            goalMet: goal,
            halted: ev.halted || 0,
            failed: ev.failed || 0,
          },
          replyRate: enrolled ? +(replied / enrolled).toFixed(3) : 0,
          conversionRate: enrolled ? +(goal / enrolled).toFixed(3) : 0,
          haltReasons: reasonsBySeq[String(s._id)] || {},
        };
      });
      res.json({ analytics });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Single enrollment detail (history timeline).
  router.get("/enrollments/:eid", async (req, res) => {
    if (!oid(req.params.eid)) return res.status(400).json({ error: "Invalid id" });
    const enr = await SequenceEnrollment.findOne({ _id: req.params.eid, userId: req.userId }).lean();
    if (!enr) return res.status(404).json({ error: "Enrollment not found" });
    res.json(enr);
  });

  // ─── Document requests (Tier-2: request_documents / wait_for_document) ───
  // List a client's requested documents (pending + received).
  router.get("/document-requests", async (req, res) => {
    try {
      const filter = { userId: req.userId };
      if (req.query.clientId) {
        if (!oid(req.query.clientId)) return res.status(400).json({ error: "Invalid clientId" });
        filter.clientId = req.query.clientId;
      }
      const requests = await DocumentRequest.find(filter).sort({ createdAt: -1 }).limit(100).lean();
      res.json({ requests });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Mark a requested document received → advances any wait_for_document parked on it.
  router.post("/document-requests/:id/receive", async (req, res) => {
    try {
      if (!oid(req.params.id)) return res.status(400).json({ error: "Invalid id" });
      const dr = await DocumentRequest.findOneAndUpdate(
        { _id: req.params.id, userId: req.userId, status: "pending" },
        { $set: { status: "received", receivedAt: new Date(), fulfilledByItemId: req.body.itemId || null } },
        { returnDocument: "after" },
      );
      if (!dr) return res.status(404).json({ error: "Request not found or already received" });
      await wakeAwaitingDocument(models, req.userId, dr.clientId);
      res.json({ success: true, request: dr.toObject() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // AI generation — Phase 3 (the constrained sub-agent). Stubbed for now.
  router.post("/generate", (req, res) => {
    res.status(501).json({ error: "AI sequence generation ships in a later phase." });
  });

  /* ───────────────────────── collection + item routes ───────────────────────── */

  // List sequences (+ denormalized stats).
  router.get("/", async (req, res) => {
    try {
      const seqs = await Sequence.find({ userId: req.userId }).sort({ updatedAt: -1 }).lean();
      res.json({ sequences: seqs });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Create — blank, or from a template.
  router.post("/", async (req, res) => {
    try {
      const { templateKey, name, description } = req.body;
      let graph, seqName, seqDesc, settings, templateKeyStored = null;

      if (templateKey) {
        const t = getTemplate(templateKey);
        if (!t) return res.status(400).json({ error: "Unknown template: " + templateKey });
        graph = JSON.parse(JSON.stringify(t.graph));
        seqName = name || t.name;
        seqDesc = description ?? t.description;
        settings = t.settings || {};
        templateKeyStored = t.key;
      } else {
        graph = req.body.graph || blankGraph();
        seqName = name || "Untitled sequence";
        seqDesc = description || "";
        settings = req.body.settings || {};
      }

      const v = validateGraph(graph, registry);
      if (!v.ok) return res.status(400).json({ error: "Invalid graph", errors: v.errors });

      const { triggerType, triggerConfig } = triggerOf(graph);
      const seq = await Sequence.create({
        userId: req.userId,
        name: seqName,
        description: seqDesc,
        status: "draft",
        version: 1,
        triggerType,
        triggerConfig,
        graph,
        settings,
        templateKey: templateKeyStored,
      });
      res.status(201).json(seq.toObject());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Detail.
  router.get("/:id", async (req, res) => {
    if (!oid(req.params.id)) return res.status(400).json({ error: "Invalid id" });
    const seq = await Sequence.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!seq) return res.status(404).json({ error: "Sequence not found" });
    res.json(seq);
  });

  // Update graph/settings/name. Validates; bumps version if the graph changed on an active seq.
  router.put("/:id", async (req, res) => {
    try {
      if (!oid(req.params.id)) return res.status(400).json({ error: "Invalid id" });
      const seq = await Sequence.findOne({ _id: req.params.id, userId: req.userId });
      if (!seq) return res.status(404).json({ error: "Sequence not found" });

      const { name, description, graph, settings } = req.body;

      if (graph) {
        const v = validateGraph(graph, registry);
        if (!v.ok) return res.status(400).json({ error: "Invalid graph", errors: v.errors });
        const changed = JSON.stringify(seq.graph) !== JSON.stringify(graph);
        seq.graph = graph;
        const { triggerType, triggerConfig } = triggerOf(graph);
        seq.triggerType = triggerType;
        seq.triggerConfig = triggerConfig;
        // In-flight enrollments keep their snapshot; bump version so future enrollments use the new graph.
        if (changed && seq.status === "active") seq.version += 1;
      }
      if (name !== undefined) seq.name = name;
      if (description !== undefined) seq.description = description;
      if (settings) seq.settings = { ...seq.settings.toObject?.() ?? seq.settings, ...settings };

      await seq.save();
      res.json(seq.toObject());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Lifecycle transitions.
  const setStatus = (target) => async (req, res) => {
    try {
      if (!oid(req.params.id)) return res.status(400).json({ error: "Invalid id" });
      const seq = await Sequence.findOne({ _id: req.params.id, userId: req.userId });
      if (!seq) return res.status(404).json({ error: "Sequence not found" });

      // Can't activate a graph that doesn't validate.
      if (target === "active") {
        const v = validateGraph(seq.graph, registry);
        if (!v.ok) return res.status(400).json({ error: "Cannot activate an invalid sequence", errors: v.errors });
      }
      seq.status = target;
      await seq.save();
      res.json({ success: true, status: seq.status });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  };
  router.post("/:id/activate", setStatus("active"));
  router.post("/:id/pause", setStatus("paused"));
  router.post("/:id/archive", setStatus("archived"));

  // Delete. Active enrollments self-halt on the next tick (engine sees the sequence is gone).
  router.delete("/:id", async (req, res) => {
    try {
      if (!oid(req.params.id)) return res.status(400).json({ error: "Invalid id" });
      const r = await Sequence.deleteOne({ _id: req.params.id, userId: req.userId });
      if (!r.deletedCount) return res.status(404).json({ error: "Sequence not found" });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Manual enroll a client.
  router.post("/:id/enroll", async (req, res) => {
    try {
      if (!oid(req.params.id)) return res.status(400).json({ error: "Invalid id" });
      const { clientId } = req.body;
      if (!oid(clientId)) return res.status(400).json({ error: "Valid clientId required" });
      const seq = await Sequence.findOne({ _id: req.params.id, userId: req.userId });
      if (!seq) return res.status(404).json({ error: "Sequence not found" });
      if (seq.status !== "active") return res.status(400).json({ error: "Sequence must be active to enroll" });
      const client = await Client.findOne({ _id: clientId, userId: req.userId }).lean();
      if (!client) return res.status(404).json({ error: "Client not found" });

      const enr = await enrollManual(models, seq, clientId);
      res.status(201).json({ success: true, enrollment: enr });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Unenroll a client — halts their active/running enrollment(s) in this sequence. We halt
  // (not delete) so the run's history/analytics are preserved, and the partial-unique index
  // frees up so the client can be re-enrolled later.
  router.post("/:id/unenroll", async (req, res) => {
    try {
      if (!oid(req.params.id)) return res.status(400).json({ error: "Invalid id" });
      const { clientId } = req.body;
      if (!oid(clientId)) return res.status(400).json({ error: "Valid clientId required" });
      const seq = await Sequence.findOne({ _id: req.params.id, userId: req.userId }).select("_id").lean();
      if (!seq) return res.status(404).json({ error: "Sequence not found" });

      const rows = await SequenceEnrollment.find({
        sequenceId: req.params.id, userId: req.userId, clientId, status: { $in: ["active", "running"] },
      }).select("_id").lean();
      if (!rows.length) return res.status(404).json({ error: "No active enrollment for this client" });

      const ids = rows.map((r) => r._id);
      await SequenceEnrollment.updateMany(
        { _id: { $in: ids } },
        {
          $set: {
            status: "halted",
            haltReason: "manual_unenroll",
            "lock.lockedBy": null,
            "lock.lockedUntil": null,
            hold: { reason: null, until: null },
          },
        },
      );
      await Sequence.updateOne(
        { _id: req.params.id },
        { $inc: { "stats.active": -ids.length, "stats.halted": ids.length } },
      );
      // Keep the analytics funnel consistent with engine-driven halts.
      await SequenceEvent.insertMany(
        ids.map((eid) => ({
          userId: new mongoose.Types.ObjectId(req.userId),
          sequenceId: new mongoose.Types.ObjectId(req.params.id),
          enrollmentId: eid,
          clientId: new mongoose.Types.ObjectId(clientId),
          type: "halted",
          meta: { reason: "manual_unenroll" },
          at: new Date(),
        })),
      ).catch(() => {});

      res.json({ success: true, unenrolled: ids.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Enrollments for a sequence.
  router.get("/:id/enrollments", async (req, res) => {
    try {
      if (!oid(req.params.id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await SequenceEnrollment.find({ sequenceId: req.params.id, userId: req.userId })
        .sort({ updatedAt: -1 })
        .limit(200)
        .lean();
      res.json({ enrollments: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Dry-run against a real client — logs intended sends, calls no provider.
  router.post("/:id/dry-run", async (req, res) => {
    try {
      if (!oid(req.params.id)) return res.status(400).json({ error: "Invalid id" });
      const { clientId } = req.body;
      const seq = await Sequence.findOne({ _id: req.params.id, userId: req.userId }).lean();
      if (!seq) return res.status(404).json({ error: "Sequence not found" });
      let client = null;
      if (clientId) {
        if (!oid(clientId)) return res.status(400).json({ error: "Invalid clientId" });
        client = await Client.findOne({ _id: clientId, userId: req.userId }).lean();
        if (!client) return res.status(404).json({ error: "Client not found" });
      }
      const result = await engineDryRun({ models, sequence: seq, client });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
