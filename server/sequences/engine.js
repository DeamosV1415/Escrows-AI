import { randomUUID } from "crypto";
import registry from "./blocks/index.js";
import * as realSenders from "./senders.js";
import { sweepSchedules } from "./triggers.js";
import { requestKick } from "./kick.js";
import {
  shouldHalt,
  quietHoursDefer,
  rateCapExceeded,
  repliedSince,
  identifierMatch,
} from "./guards.js";
import {
  LOCK_TTL_MS,
  BATCH_SIZE,
  HOP_CAP,
  MAX_STEPS_PER_ENROLLMENT,
  MAX_SEND_RETRIES,
  backoffMs,
  durationToMs,
  WAIT_FOR_REPLY_DEFAULT_TIMEOUT,
  globalKillEngaged,
  DEFAULTS,
} from "./constants.js";

/* ────────────────────────── helpers ────────────────────────── */

function toPlainGraph(g) {
  if (!g) return { nodes: [], edges: [] };
  return JSON.parse(JSON.stringify(g));
}

function edgeTarget(graph, sourceId, handle) {
  const e = (graph.edges || []).find((ed) => ed.source === sourceId && ed.handle === handle);
  return e ? e.target : null;
}

function startNodeId(graph) {
  const trigger = (graph.nodes || []).find((n) => n.family === "trigger");
  if (!trigger) return null;
  return edgeTarget(graph, trigger.id, "out");
}

async function emit(models, { sequence, enrollment, type, nodeId = null, handle = null, clientId = null, meta = {} }) {
  try {
    await models.SequenceEvent.create({
      userId: sequence?.userId ?? enrollment?.userId,
      sequenceId: enrollment?.sequenceId ?? sequence?._id,
      enrollmentId: enrollment?._id ?? null,
      clientId: clientId ?? enrollment?.clientId ?? null,
      type,
      nodeId,
      handle,
      meta,
      at: new Date(),
    });
  } catch {
    /* analytics must never break execution */
  }
}

async function bumpStats(models, sequenceId, inc) {
  const $inc = {};
  for (const [k, v] of Object.entries(inc)) if (v) $inc[`stats.${k}`] = v;
  if (Object.keys($inc).length) {
    await models.Sequence.updateOne({ _id: sequenceId }, { $inc }).catch(() => {});
  }
}

function clearLock(e) {
  e.lock = { lockedBy: null, lockedUntil: null };
}

async function releaseActive(e, nextRunAt) {
  e.status = "active";
  if (nextRunAt) e.nextRunAt = nextRunAt;
  clearLock(e);
  await e.save();
  return e;
}

// Park the enrollment with a visible reason (quiet hours / rate cap / kill switch) so the
// UI can explain why nothing has been sent yet — never a silent stall.
async function releaseHold(e, until, reason) {
  e.hold = { reason, until: until || null };
  return releaseActive(e, until);
}

function clearHold(e) {
  if (e.hold && (e.hold.reason || e.hold.until)) e.hold = { reason: null, until: null };
}

async function terminate(models, e, status, { reason = null, goal = false, goalName = null } = {}) {
  e.status = status;
  if (reason) e.haltReason = reason;
  clearLock(e);
  await e.save();
  const statKey = status === "completed" ? "completed" : status === "halted" ? "halted" : "failed";
  await bumpStats(models, e.sequenceId, { active: -1, [statKey]: 1 });
  await emit(models, { enrollment: e, type: status, meta: { reason, goalName } });
  if (status === "completed" && goal) {
    await emit(models, { enrollment: e, type: "goal_met", meta: { goalName } });
  }
  return e;
}

/* ────────────────────────── enrollment ────────────────────────── */

export async function enrollClient({ models, sequence, clientId = null, now = new Date() }) {
  const graph = toPlainGraph(sequence.graph);
  const start = startNodeId(graph);
  if (!start) return null;

  try {
    const enr = await models.SequenceEnrollment.create({
      userId: sequence.userId,
      sequenceId: sequence._id,
      sequenceVersion: sequence.version,
      graphSnapshot: graph,
      clientId: clientId || null,
      status: "active",
      currentNodeId: start,
      nextRunAt: now,
      enrolledAt: now,
    });
    await bumpStats(models, sequence._id, { enrolled: 1, active: 1 });
    await emit(models, { sequence, enrollment: enr, type: "enrolled", clientId });
    requestKick(); // run the first step now, not at the next heartbeat
    return enr;
  } catch (e) {
    if (e?.code === 11000) {
      // already actively enrolled — partial unique index protected us from a duplicate
      return models.SequenceEnrollment.findOne({
        sequenceId: sequence._id,
        clientId: clientId || null,
        status: { $in: ["active", "running"] },
      });
    }
    throw e;
  }
}

/* ────────────────────────── claim ────────────────────────── */

async function claimOne(models, now, workerId) {
  return models.SequenceEnrollment.findOneAndUpdate(
    {
      nextRunAt: { $lte: now },
      $or: [
        { status: "active" },
        { status: "running", "lock.lockedUntil": { $lte: now } }, // reclaim crashed locks
      ],
    },
    {
      $set: {
        status: "running",
        lock: { lockedBy: workerId, lockedUntil: new Date(now.getTime() + LOCK_TTL_MS) },
      },
    },
    { sort: { nextRunAt: 1 }, returnDocument: "after" },
  );
}

/* ────────────────────────── tick ────────────────────────── */

export async function tick({ models, senders = realSenders, now = new Date(), workerId, batch = BATCH_SIZE } = {}) {
  if (globalKillEngaged()) return { claimed: 0, processed: 0, killed: true };
  const wid = workerId || randomUUID();

  // Arm any due/missing broker-scoped schedule enrollments (the digest) before draining.
  const armed = await sweepSchedules(models, now);

  let claimed = 0;
  let processed = 0;
  for (let i = 0; i < batch; i++) {
    const enr = await claimOne(models, now, wid);
    if (!enr) break;
    claimed++;
    try {
      await processEnrollment({ models, senders, enrollment: enr, now, workerId: wid });
      processed++;
    } catch (err) {
      await terminate(models, enr, "failed", { reason: "engine_error: " + (err?.message || err) }).catch(() => {});
    }
  }
  return { claimed, processed, armed };
}

/* ────────────────────────── process one enrollment ────────────────────────── */

// Has the broker marked the requested document received since the wait armed? Keyed on the
// tracked DocumentRequest (not raw inventory uploads), so an unrelated file can't satisfy it.
async function documentReceived(models, enrollment, since, docName) {
  if (!enrollment?._id || !since || !models.DocumentRequest) return false;
  const q = { enrollmentId: enrollment._id, status: "received", receivedAt: { $gt: since } };
  if (docName) q.docName = docName;
  const r = await models.DocumentRequest.findOne(q).select("_id").lean();
  return !!r;
}

async function findRecentOutbound(models, client, body, since) {
  if (!client) return null;
  const ors = identifierMatch(client);
  if (!ors.length) return null;
  return models.Message.findOne({
    userId: client.userId,
    direction: "outbound",
    body,
    timestamp: { $gte: since },
    $or: ors,
  })
    .select("externalId")
    .lean();
}

export async function processEnrollment({ models, senders = realSenders, enrollment, now = new Date(), dryRun = false }) {
  const e = enrollment;

  // Load the broker's sequence settings once — used for the kill switch AND to source the
  // broker's real timezone/quiet hours below.
  const brokerSettings = models.SequenceSettings
    ? await models.SequenceSettings.findOne({ userId: e.userId }).lean()
    : null;

  // global per-broker kill switch → back off and retry later (visible hold)
  if (!dryRun && brokerSettings?.killSwitch) {
    return releaseHold(e, new Date(now.getTime() + 5 * 60_000), "kill_switch");
  }

  const seq = await models.Sequence.findById(e.sequenceId).lean();
  if (!seq) return terminate(models, e, "halted", { reason: "sequence_deleted" });
  const settings = { ...DEFAULTS, ...(seq.settings || {}) };

  // Timezone fallback: when a client has no timezone of its own, per-node quiet hours and
  // schedule/wait_until timing fall back to this. An explicit non-UTC per-sequence tz wins;
  // otherwise use the broker's detected timezone (captured from the browser).
  if ((!seq.settings?.timezone || seq.settings.timezone === "UTC") && brokerSettings?.defaultTimezone) {
    settings.timezone = brokerSettings.defaultTimezone;
  }

  // Per-broker defaults are authoritative for these knobs (per-sequence overrides are
  // deferred). The rate cap MUST be broker-level: the count is across all sequences, so a
  // per-sequence number would be incoherent. Fall back to the per-sequence/DEFAULTS value
  // only when the broker hasn't set one.
  if (brokerSettings?.maxPerClientPerDay != null) settings.maxPerClientPerDay = brokerSettings.maxPerClientPerDay;
  if (brokerSettings?.stopOnReply != null) settings.stopOnReply = brokerSettings.stopOnReply;
  if (brokerSettings?.stopOnClosed != null) settings.stopOnClosed = brokerSettings.stopOnClosed;

  const user = await models.User.findById(e.userId).lean();
  let client = e.clientId ? await models.Client.findById(e.clientId).lean() : null;

  // stop conditions, re-evaluated at execution time
  const halt = await shouldHalt(models, e, client, settings);
  if (halt.halt) return terminate(models, e, "halted", { reason: halt.reason });

  let hops = 0;
  while (true) {
    if (e.stepsExecuted >= (settings.maxStepsPerEnrollment || MAX_STEPS_PER_ENROLLMENT)) {
      return terminate(models, e, "halted", { reason: "max_steps_exceeded" });
    }
    const node = (e.graphSnapshot.nodes || []).find((n) => n.id === e.currentNodeId);
    if (!node) return terminate(models, e, "failed", { reason: "node_not_found:" + e.currentNodeId });
    if (!node.config) node.config = {}; // Mongoose can drop empty {} from Mixed; executors assume an object
    const block = registry.get(node.type);
    if (!block) return terminate(models, e, "failed", { reason: "unknown_block:" + node.type });

    // precompute reply flags the executors need
    const ctx = {
      models,
      senders,
      enrollment: e,
      sequence: seq,
      node,
      client,
      user,
      now,
      dryRun,
      _repliedSinceEnroll: false,
      _repliedSinceWait: false,
      _documentSinceWait: false,
    };
    if (node.type === "condition" && node.config?.field === "replied") {
      ctx._repliedSinceEnroll = await repliedSince(models, client, e.enrolledAt);
    }
    if (node.type === "wait_for_reply" && e.waitContext?.nodeId === node.id && e.waitContext?.startedAt) {
      ctx._repliedSinceWait = await repliedSince(models, client, e.waitContext.startedAt);
    }
    if (node.type === "wait_for_document" && e.waitContext?.nodeId === node.id && e.waitContext?.startedAt) {
      ctx._documentSinceWait = await documentReceived(models, e, e.waitContext.startedAt, node.config?.docName);
    }

    const directive = await block.execute(ctx);

    /* ── delay: schedule and yield ── */
    if (directive.kind === "delay") {
      const next = edgeTarget(e.graphSnapshot, node.id, directive.handle);
      if (!next) return terminate(models, e, "failed", { reason: "no_edge:" + directive.handle });
      e.history.push({ nodeId: node.id, type: node.type, status: "done", handleFollowed: directive.handle, detail: `wait ${directive.ms}ms`, at: now });
      e.currentNodeId = next;
      e.stepsExecuted += 1;
      return releaseActive(e, new Date(now.getTime() + directive.ms));
    }

    /* ── await reply: arm and yield ── */
    if (directive.kind === "await") {
      const timeoutMs = directive.timeoutMs || durationToMs(WAIT_FOR_REPLY_DEFAULT_TIMEOUT);
      if (e.waitContext?.nodeId !== node.id) {
        e.waitContext = { nodeId: node.id, startedAt: now };
      }
      const startedAt = new Date(e.waitContext.startedAt).getTime();
      return releaseActive(e, new Date(startedAt + timeoutMs));
    }

    /* ── terminal ── */
    if (directive.kind === "complete") {
      e.history.push({ nodeId: node.id, type: node.type, status: "done", detail: directive.goal ? "goal" : "end", at: now });
      e.stepsExecuted += 1;
      return terminate(models, e, "completed", { goal: directive.goal, goalName: directive.goalName });
    }
    if (directive.kind === "halt") {
      return terminate(models, e, "halted", { reason: directive.reason || "block_halt" });
    }

    /* ── enroll in another sequence, then advance ── */
    if (directive.kind === "enroll") {
      if (!dryRun) {
        const target = await models.Sequence.findById(directive.targetSequenceId);
        if (target && target.status === "active") {
          await enrollClient({ models, sequence: target, clientId: e.clientId, now });
        }
      }
      const next = edgeTarget(e.graphSnapshot, node.id, directive.handle);
      e.history.push({ nodeId: node.id, type: node.type, status: "done", handleFollowed: directive.handle, detail: "enrolled in " + directive.targetSequenceId, at: now });
      e.stepsExecuted += 1;
      if (!next) return terminate(models, e, "completed", {});
      e.currentNodeId = next;
      await emit(models, { enrollment: e, type: "node_entered", nodeId: node.id, handle: directive.handle });
      await e.save();
      if (++hops >= HOP_CAP) return releaseActive(e, now);
      continue;
    }

    /* ── send: crash-safe, idempotent ── */
    if (directive.kind === "send") {
      const next = edgeTarget(e.graphSnapshot, node.id, directive.handle);
      if (!next) return terminate(models, e, "failed", { reason: "no_edge:" + directive.handle });

      if (dryRun) {
        e.currentNodeId = next;
        e.stepsExecuted += 1;
        continue;
      }

      // quiet hours / rate cap → defer the SEND (waits are exempt; this is a send).
      // Quiet hours are opt-in PER NODE and evaluated in the CLIENT's timezone.
      if (directive.quiet?.enabled) {
        const clientTz = client?.timezone || settings.timezone;
        const defer = quietHoursDefer(now, { quietHours: { start: directive.quiet.start, end: directive.quiet.end } }, clientTz);
        if (defer) {
          e.history.push({ nodeId: node.id, type: node.type, status: "deferred", detail: `quiet hours (${clientTz})`, at: now });
          await emit(models, { enrollment: e, type: "deferred", nodeId: node.id, meta: { reason: "quiet_hours", tz: clientTz } });
          return releaseHold(e, defer, "quiet_hours");
        }
      }
      if (await rateCapExceeded(models, client, settings, now)) {
        const until = new Date(now.getTime() + 6 * 3_600_000);
        e.history.push({ nodeId: node.id, type: node.type, status: "deferred", detail: "rate cap", at: now });
        await emit(models, { enrollment: e, type: "deferred", nodeId: node.id, meta: { reason: "rate_cap" } });
        return releaseHold(e, until, "rate_cap");
      }

      // idempotency: already sent this node?
      let result = null;
      const prior = e.history.find((h) => h.nodeId === node.id && h.status === "done" && h.externalId);
      if (prior) {
        result = { externalId: prior.externalId };
      } else {
        // crash mid-send recovery: if we marked inFlight for this node, look for the message we may have sent
        if (e.inFlight?.nodeId === node.id) {
          const dup = await findRecentOutbound(models, client, e.inFlight.body, e.inFlight.startedAt);
          if (dup) result = { externalId: dup.externalId };
        }
        if (!result) {
          // durable pre-send marker BEFORE hitting the provider
          e.inFlight = { nodeId: node.id, body: directive.body, startedAt: now };
          await e.save();
          try {
            const sendArgs = { Connection: models.Connection, Message: models.Message };
            result =
              directive.channel === "gmail"
                ? await senders.sendEmail(sendArgs, e.userId, { to: directive.to, subject: directive.subject, body: directive.body, contactName: directive.contactName })
                : await senders.sendWhatsApp(sendArgs, e.userId, { to: directive.to, body: directive.body, contactName: directive.contactName });
          } catch (err) {
            e.inFlight = { nodeId: null, body: null, startedAt: null };
            const attempts = (e.attempts?.[node.id] || 0) + 1;
            e.attempts = { ...(e.attempts || {}), [node.id]: attempts };
            e.markModified("attempts");
            e.history.push({ nodeId: node.id, type: node.type, status: "failed", error: err?.message || String(err), at: now });
            await emit(models, { enrollment: e, type: "message_failed", nodeId: node.id, meta: { attempt: attempts, error: err?.message } });
            if (attempts < MAX_SEND_RETRIES) {
              return releaseActive(e, new Date(now.getTime() + backoffMs(attempts - 1)));
            }
            return terminate(models, e, "failed", { reason: "send_failed:" + (err?.message || "") });
          }
        }
      }

      e.inFlight = { nodeId: null, body: null, startedAt: null };
      clearHold(e); // a send went out — no longer parked
      e.history.push({ nodeId: node.id, type: node.type, status: "done", handleFollowed: directive.handle, externalId: result.externalId || null, detail: `${directive.channel} → ${directive.to}`, at: now });
      e.stepsExecuted += 1;
      e.currentNodeId = next;
      await emit(models, { enrollment: e, type: "message_sent", nodeId: node.id, meta: { channel: directive.channel } });
      await e.save();
      if (++hops >= HOP_CAP) return releaseActive(e, now);
      continue;
    }

    /* ── next: generic advance (condition / update_client / notify / compose_digest / trigger / wait_for_reply resolve) ── */
    if (directive.kind === "next") {
      // leaving a wait_for_reply node clears its wait context
      if (e.waitContext?.nodeId === node.id) e.waitContext = { nodeId: null, startedAt: null };

      const next = edgeTarget(e.graphSnapshot, node.id, directive.handle);
      if (!next) return terminate(models, e, "failed", { reason: "no_edge:" + directive.handle });

      const status = directive.skipped ? "skipped" : "done";
      e.history.push({ nodeId: node.id, type: node.type, status, handleFollowed: directive.handle, detail: directive.detail || directive.skipped || "", at: now });
      e.stepsExecuted += 1;
      e.currentNodeId = next;

      const evType = node.type === "condition" ? "branched" : directive.skipped ? "message_failed" : "node_entered";
      await emit(models, { enrollment: e, type: evType, nodeId: node.id, handle: directive.handle, meta: directive.notify ? { notify: directive.notify } : { skipped: directive.skipped } });

      // Deliver in-app alerts (notify_broker / compose_digest) to the notification sink.
      if (directive.notify && !dryRun && models.Notification) {
        await models.Notification.create({
          userId: e.userId,
          source: node.type === "compose_digest" ? "digest" : "sequence",
          message: directive.notify.message,
          priority: directive.notify.priority || "medium",
          sequenceId: e.sequenceId,
          enrollmentId: e._id,
          clientId: e.clientId || null,
        }).catch(() => {});
      }

      if (!dryRun) await e.save();
      if (++hops >= HOP_CAP) return releaseActive(e, now);
      continue;
    }

    // unknown directive — fail safe
    return terminate(models, e, "failed", { reason: "bad_directive:" + directive.kind });
  }
}

/* ────────────────────────── dry-run (no writes, no sends) ────────────────────────── */

export async function dryRun({ models, sequence, client, now = new Date() }) {
  const graph = toPlainGraph(sequence.graph);
  const user = await models.User.findById(sequence.userId).lean();
  let nodeId = startNodeId(graph);
  const log = [];
  let steps = 0;

  while (nodeId && steps < 100) {
    steps++;
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) { log.push({ nodeId, action: "error", detail: "node not found" }); break; }
    if (!node.config) node.config = {};
    const block = registry.get(node.type);
    if (!block) { log.push({ nodeId, action: "error", detail: "unknown block " + node.type }); break; }

    const ctx = {
      models,
      enrollment: { userId: sequence.userId, enrolledAt: now, waitContext: {} },
      sequence,
      node,
      client,
      user,
      now,
      dryRun: true,
      _repliedSinceEnroll: false,
      _repliedSinceWait: false,
    };
    const d = await block.execute(ctx);

    if (d.kind === "send") {
      log.push({ nodeId: node.id, type: node.type, action: "would_send", channel: d.channel, to: d.to, subject: d.subject, body: d.body });
      nodeId = edgeTarget(graph, node.id, d.handle);
    } else if (d.kind === "delay") {
      log.push({ nodeId: node.id, type: node.type, action: "would_wait", ms: d.ms });
      nodeId = edgeTarget(graph, node.id, d.handle);
    } else if (d.kind === "await") {
      log.push({ nodeId: node.id, type: node.type, action: "would_wait_for_reply", assumedBranch: "timeout" });
      nodeId = edgeTarget(graph, node.id, "timeout");
    } else if (d.kind === "enroll") {
      log.push({ nodeId: node.id, type: node.type, action: "would_enroll_in", target: d.targetSequenceId });
      nodeId = edgeTarget(graph, node.id, d.handle);
    } else if (d.kind === "next") {
      log.push({ nodeId: node.id, type: node.type, action: d.skipped ? "skip" : "do", handle: d.handle, detail: d.detail || d.skipped || "" });
      nodeId = edgeTarget(graph, node.id, d.handle);
    } else if (d.kind === "complete") {
      log.push({ nodeId: node.id, type: node.type, action: "end", goal: !!d.goal });
      break;
    } else if (d.kind === "halt") {
      log.push({ nodeId: node.id, type: node.type, action: "halt", reason: d.reason });
      break;
    } else break;
  }
  return { ok: true, log };
}

/* ────────────────────────── reply wake (wired from webhooks in Phase 1) ────────────────────────── */

export async function wakeAwaitingReply(models, userId, contactIdentifier) {
  const ors = [{ email: (contactIdentifier || "").toLowerCase() }];
  const d = (contactIdentifier || "").replace(/\D/g, "");
  if (d.length >= 10) ors.push({ phone: { $regex: d.slice(-10) + "$" } });
  const clients = await models.Client.find({ userId, $or: ors }).select("_id").lean();
  if (!clients.length) return 0;
  const clientIds = clients.map((c) => c._id);
  const now = new Date();

  // (1) Wake any enrollment parked on a wait so wait_for_reply / wait_for_document re-evaluate.
  await models.SequenceEnrollment.updateMany(
    { userId, clientId: { $in: clientIds }, status: "active", "waitContext.nodeId": { $ne: null } },
    { $set: { nextRunAt: now } },
  );

  // (2) Record the reply ONCE per enrollment for analytics (the "Replied" funnel + reply rate).
  // Credit every still-active enrollment of this client that hasn't already logged a reply.
  // The repliedAt guard on updateOne makes this atomic/idempotent under concurrent webhooks.
  const fresh = await models.SequenceEnrollment.find({
    userId, clientId: { $in: clientIds }, status: { $in: ["active", "running"] }, repliedAt: null,
  }).select("_id sequenceId clientId").lean();

  let logged = 0;
  for (const enr of fresh) {
    const res = await models.SequenceEnrollment.updateOne({ _id: enr._id, repliedAt: null }, { $set: { repliedAt: now } });
    if (res.modifiedCount && models.SequenceEvent) {
      await models.SequenceEvent.create({
        userId, sequenceId: enr.sequenceId, enrollmentId: enr._id, clientId: enr.clientId, type: "replied", at: now,
      }).catch(() => {});
      logged++;
    }
  }
  return logged;
}

/**
 * Called from the inventory upload route: a new document landed for this client, so any
 * enrollment parked on a wait_for_document node should re-check now. Waking other waiting
 * nodes (e.g. wait_for_reply) is harmless — they simply re-evaluate and re-arm.
 */
export async function wakeAwaitingDocument(models, userId, clientId) {
  if (!clientId) return 0;
  const r = await models.SequenceEnrollment.updateMany(
    { userId, clientId, status: "active", "waitContext.nodeId": { $ne: null } },
    { $set: { nextRunAt: new Date() } },
  );
  return r.modifiedCount || 0;
}
