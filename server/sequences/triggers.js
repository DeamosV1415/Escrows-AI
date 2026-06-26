import { enrollClient } from "./engine.js";
import { nextScheduleTime } from "./schedule.js";

/**
 * Trigger wiring: turns real-world events (a client is created, a stage changes,
 * a clock tick) into sequence enrollments. Every function here is best-effort and
 * MUST NEVER throw into its caller's request path — a failed enrollment can never
 * break client creation or an inbound webhook. Errors are logged and swallowed.
 */

function activeSequences(models, userId, triggerType) {
  return models.Sequence.find({
    userId,
    status: "active",
    triggerType,
  }).lean();
}

function matchesCreatedFilter(filter, client) {
  if (!filter) return true;
  if (filter.stageIs && client.stage !== filter.stageIs) return false;
  if (filter.intentIs && client.intent !== filter.intentIs) return false;
  return true;
}

/** A new client was created (via UI or copilot). Enroll into client_created sequences. */
export async function enrollOnClientCreated(models, client) {
  try {
    if (!client || client.optedOut) return 0;
    const seqs = await activeSequences(models, client.userId, "client_created");
    let n = 0;
    for (const seq of seqs) {
      const filter = seq.triggerConfig?.filter;
      if (!matchesCreatedFilter(filter, client)) continue;
      const enr = await enrollClient({ models, sequence: seq, clientId: client._id });
      if (enr) n++;
    }
    if (n) console.log(`🔁 client_created → enrolled ${client.name} into ${n} sequence(s)`);
    return n;
  } catch (e) {
    console.error("⚠️ enrollOnClientCreated failed:", e?.message);
    return 0;
  }
}

/** A client's stage transitioned. Enroll into stage_changed sequences whose target matches. */
export async function enrollOnStageChanged(models, client, prevStage, newStage) {
  try {
    if (!newStage || prevStage === newStage) return 0;
    if (client.optedOut) return 0;
    const seqs = await activeSequences(models, client.userId, "stage_changed");
    let n = 0;
    for (const seq of seqs) {
      const cfg = seq.triggerConfig || {};
      if (cfg.toStage && cfg.toStage !== newStage) continue;
      if (cfg.fromStage && cfg.fromStage !== prevStage) continue;
      const enr = await enrollClient({ models, sequence: seq, clientId: client._id });
      if (enr) n++;
    }
    if (n) console.log(`🔁 stage_changed (${prevStage}→${newStage}) → enrolled ${client.name} into ${n} sequence(s)`);
    return n;
  } catch (e) {
    console.error("⚠️ enrollOnStageChanged failed:", e?.message);
    return 0;
  }
}

/** Manual enrollment from the UI / API. Returns the enrollment (or null). */
export async function enrollManual(models, sequence, clientId) {
  return enrollClient({ models, sequence, clientId });
}

/**
 * Schedule sweep — called from each engine tick. For every active `schedule` sequence,
 * ensure exactly one broker-scoped (clientId=null) enrollment is armed for the next
 * fire time. The partial-unique index on (sequenceId, clientId) guarantees no duplicate
 * while one is active/running; once it completes, the next sweep arms the following period.
 */
export async function sweepSchedules(models, now = new Date()) {
  let armed = 0;
  try {
    const seqs = await models.Sequence.find({ status: "active", triggerType: "schedule" }).lean();
    for (const seq of seqs) {
      const existing = await models.SequenceEnrollment.findOne({
        sequenceId: seq._id,
        clientId: null,
        status: { $in: ["active", "running"] },
      }).select("_id").lean();
      if (existing) continue;

      const cfg = seq.triggerConfig || {};
      const fallbackTz = seq.settings?.timezone || "UTC";
      const fireAt = nextScheduleTime(now, cfg, fallbackTz);
      await enrollClient({ models, sequence: seq, clientId: null, now: fireAt });
      armed++;
    }
  } catch (e) {
    console.error("⚠️ sweepSchedules failed:", e?.message);
  }
  return armed;
}
