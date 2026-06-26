/**
 * Runtime safety guards. These wrap every node execution so a sequence can never send at
 * the wrong time, to the wrong person, too often, or after a deal is dead.
 */

function digits(s) {
  return (s || "").replace(/\D/g, "");
}

/** $or conditions matching a client's email or phone (last 10 digits) in the Message collection. */
export function identifierMatch(client) {
  const ors = [];
  if (client?.email) ors.push({ contactIdentifier: client.email.toLowerCase() });
  const d = digits(client?.phone);
  if (d.length >= 10) ors.push({ contactIdentifier: { $regex: d.slice(-10) + "$" } });
  return ors;
}

/** Has the client sent an inbound message since `since`? */
export async function repliedSince(models, client, since) {
  if (!client || !since) return false;
  const ors = identifierMatch(client);
  if (!ors.length) return false;
  const m = await models.Message.findOne({
    userId: client.userId,
    direction: "inbound",
    timestamp: { $gt: since },
    $or: ors,
  })
    .select("_id")
    .lean();
  return !!m;
}

/**
 * Does this graph explicitly handle replies? A `wait_for_reply` block or a `condition` on
 * the `replied` field means the sequence routes replies itself (Replied/Timeout branches).
 * When it does, the blunt global `stopOnReply` net must step aside — otherwise it would
 * terminate the enrollment the instant a reply arrives and the block's "Replied" branch
 * could never run. `stopOnReply` therefore only protects drip sequences that have no such
 * block of their own.
 */
export function sequenceHandlesReplies(graph) {
  const nodes = graph?.nodes || [];
  return nodes.some(
    (n) => n.type === "wait_for_reply" || (n.type === "condition" && n.config?.field === "replied"),
  );
}

/** Should this enrollment stop entirely? Checked at execution time, every step. */
export async function shouldHalt(models, enrollment, client, settings) {
  if (enrollment.clientId && !client) return { halt: true, reason: "client_deleted" };
  if (client?.optedOut) return { halt: true, reason: "client_opted_out" };
  if (settings.stopOnClosed && client?.stage === "Closed") return { halt: true, reason: "deal_closed" };
  if (settings.stopOnReply && !sequenceHandlesReplies(enrollment.graphSnapshot)) {
    const replied = await repliedSince(models, client, enrollment.enrolledAt);
    if (replied) return { halt: true, reason: "client_replied" };
  }
  return { halt: false };
}

function parseHM(s) {
  const [h, m] = String(s || "0:0").split(":").map(Number);
  return (h % 24) * 60 + (m || 0);
}

function localMinutes(now, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz || "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour").value) % 24;
  const m = Number(parts.find((p) => p.type === "minute").value);
  return h * 60 + m;
}

/**
 * If `now` is inside quiet hours, returns the Date to defer a SEND until (the next
 * end-of-quiet). Returns null if sending is allowed now. Evaluated in `tz` — the CLIENT's
 * timezone, so international recipients aren't messaged at 3am — falling back to the
 * sequence/broker timezone. Waits/internal nodes are exempt; only send nodes consult this,
 * and only when that node has opted in (node.config.quietHours.enabled).
 */
export function quietHoursDefer(now, settings, tz) {
  const qh = settings.quietHours;
  if (!qh || !qh.start || !qh.end) return null;
  const start = parseHM(qh.start);
  const end = parseHM(qh.end);
  if (start === end) return null; // disabled
  const t = localMinutes(now, tz || settings.timezone);
  const inQuiet = start < end ? t >= start && t < end : t >= start || t < end;
  if (!inQuiet) return null;
  let minutesUntilEnd = (end - t + 1440) % 1440;
  if (minutesUntilEnd === 0) minutesUntilEnd = 1440;
  return new Date(now.getTime() + minutesUntilEnd * 60_000);
}

/** Has this client already received the max allowed outbound messages in the last 24h? */
export async function rateCapExceeded(models, client, settings, now = new Date()) {
  if (!client) return false;
  const cap = settings.maxPerClientPerDay ?? 2;
  if (cap <= 0) return false;
  const ors = identifierMatch(client);
  if (!ors.length) return false;
  const since = new Date(now.getTime() - 86_400_000);
  const count = await models.Message.countDocuments({
    userId: client.userId,
    direction: "outbound",
    timestamp: { $gte: since },
    $or: ors,
  });
  return count >= cap;
}

/** Per-broker kill switch (complements the global env SEQUENCES_GLOBAL_KILL). */
export async function brokerKillSwitch(models, userId) {
  if (!models.SequenceSettings) return false;
  const s = await models.SequenceSettings.findOne({ userId }).select("killSwitch").lean();
  return !!s?.killSwitch;
}
