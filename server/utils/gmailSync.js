import { createGmailClient } from "./gmailClient.js";
import { wakeAwaitingReply } from "../sequences/engine.js";
import { publish } from "./realtime.js";

/**
 * Sync new Gmail messages for a given connection.
 *
 * Strategy: scan a bounded, recent window of INBOX messages and store any that
 * belong to a tracked contact / client and aren't already saved (deduped by
 * `externalId`). This is *idempotent* — every call re-scans the same window
 * rather than advancing a cursor — so a message that Gmail hasn't surfaced yet
 * (the History API and message list are eventually consistent) is simply picked
 * up on the next sync instead of being skipped forever.
 *
 * The previous implementation used the History API with an advancing historyId
 * cursor; because it advanced the cursor to the latest profile historyId even
 * when `history.list` returned nothing (consistency lag), freshly-arrived
 * messages were permanently skipped. This scan-based approach avoids that.
 *
 * @param {Object} connection - The Connection mongoose document
 * @param {Object} Message - The Message mongoose model
 * @param {Object} TrackedContact - The TrackedContact mongoose model
 * @param {Object} Client - The Client mongoose model
 * @param {Object} [sequenceModels] - Optional sequence models; when provided,
 *        inbound replies wake any enrollment waiting on a reply.
 * @returns {number} Number of new messages stored
 */
export async function syncGmailMessages(connection, Message, TrackedContact, Client, sequenceModels = null) {
  const userId = connection.userId;
  const emailAddress = connection.gmailEmail;

  let gmail;
  try {
    ({ gmail } = createGmailClient(connection));
  } catch (err) {
    console.error(`❌ Gmail client creation failed for ${emailAddress}:`, err.message);
    return 0;
  }

  // How many days back / how many messages to scan each sync. A small window is
  // enough to catch anything that arrived since the last sync (manual or every
  // few minutes via auto-sync) and keeps each pass cheap.
  const SCAN_WINDOW = process.env.GMAIL_SCAN_QUERY || "newer_than:14d";
  const MAX_RESULTS = Number(process.env.GMAIL_SCAN_MAX) || 50;

  let newCount = 0;

  try {
    const listResponse = await gmail.users.messages.list({
      userId: "me",
      maxResults: MAX_RESULTS,
      q: SCAN_WINDOW,
      labelIds: ["INBOX"],
    });

    const messages = listResponse.data.messages || [];

    for (const msg of messages) {
      const stored = await processGmailMessage(
        gmail, msg.id, userId, emailAddress, Message, TrackedContact, Client, sequenceModels
      );
      if (stored) newCount++;
    }

    // Keep historyId fresh so the Pub/Sub webhook & watch renewal stay anchored,
    // and record when we last synced (useful for debugging / UI).
    try {
      const profile = await gmail.users.getProfile({ userId: "me" });
      connection.gmailHistoryId = profile.data.historyId;
      connection.lastSyncAt = new Date();
      await connection.save();
    } catch {
      // non-critical
    }

    // Opportunistically keep the Pub/Sub watch alive. This is what makes the
    // webhook the *primary* real-time path in production — without renewal the
    // watch expires after ~7 days and push notifications silently stop. No-op
    // unless the watch is missing or within a day of expiring.
    await ensureGmailWatch(connection, gmail);

    if (newCount > 0) {
      console.log(`📬 Gmail sync: ${newCount} new message(s) stored for ${emailAddress}`);
    }
    return newCount;
  } catch (err) {
    console.error(`❌ Gmail sync failed for ${emailAddress}:`, err.message);
    return newCount;
  }
}

// Renew the Pub/Sub watch when it's within this long of expiring.
const WATCH_RENEW_BEFORE_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * Ensure the Gmail Pub/Sub watch for a connection is alive. Cheap no-op unless
 * the watch is missing or about to expire, so it's safe to call on every sync.
 * Requires GOOGLE_PUBSUB_TOPIC; if push isn't configured, it does nothing.
 */
async function ensureGmailWatch(connection, gmail) {
  if (!process.env.GOOGLE_PUBSUB_TOPIC) return; // push notifications not configured

  const expiry = connection.gmailWatchExpiry
    ? new Date(connection.gmailWatchExpiry).getTime()
    : 0;
  if (expiry - Date.now() > WATCH_RENEW_BEFORE_MS) return; // still comfortably valid

  try {
    const res = await gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName: process.env.GOOGLE_PUBSUB_TOPIC,
        labelIds: ["INBOX"],
      },
    });
    connection.gmailWatchExpiry = new Date(parseInt(res.data.expiration));
    await connection.save();
    console.log(
      `👁️ Gmail watch renewed for ${connection.gmailEmail}, expires: ${connection.gmailWatchExpiry}`
    );
  } catch (err) {
    console.error(`⚠️ Gmail watch renewal failed for ${connection.gmailEmail}:`, err.message);
  }
}

/**
 * Run an async worker over a list with a bounded concurrency. Keeps the
 * reconciliation pass from being a strictly sequential `sum of all accounts`
 * while not opening an unbounded number of Gmail connections at once.
 */
async function runWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const size = Math.max(1, Math.min(limit, queue.length));
  const workers = Array.from({ length: size }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Periodic background reconciliation sync for every connected Gmail account.
 *
 * In production the Pub/Sub webhook is the primary, real-time ingestion path —
 * this loop is a *safety net* that catches anything the webhook misses (watch
 * gaps, server downtime, dropped notifications) and self-heals historyId drift,
 * so it runs infrequently. In development (localhost can't receive Pub/Sub
 * pushes) it is the only ingestion path, so it runs more often.
 *
 * Accounts are processed with bounded concurrency so the pass scales with user
 * count instead of being a strict sequential sum.
 *
 * @param {Object} models - { Connection, Message, TrackedContact, Client, sequenceModels }
 * @returns {Object|null} the interval timer, or null if disabled
 */
export function startGmailAutoSync({ Connection, Message, TrackedContact, Client, sequenceModels }) {
  if (process.env.GMAIL_AUTOSYNC_DISABLED === "1") return null;

  const isProd = process.env.NODE_ENV === "production";
  // Prod: slow reconciliation net (webhook is primary). Dev: snappy (only path).
  const DEFAULT_INTERVAL_MS = isProd ? 30 * 60 * 1000 : 60 * 1000;
  const INTERVAL_MS = Number(process.env.GMAIL_SYNC_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  const CONCURRENCY = Number(process.env.GMAIL_SYNC_CONCURRENCY) || 5;
  let running = false;

  const run = async () => {
    if (running) return; // never overlap runs in-process
    running = true;
    try {
      const connections = await Connection.find({ channel: "gmail", status: "connected" });
      await runWithConcurrency(connections, CONCURRENCY, async (conn) => {
        try {
          await syncGmailMessages(conn, Message, TrackedContact, Client, sequenceModels);
        } catch (e) {
          console.error(`⚠️ Gmail auto-sync failed for ${conn.gmailEmail}:`, e?.message);
        }
      });
    } catch (e) {
      console.error("⚠️ Gmail auto-sync error:", e?.message);
    } finally {
      running = false;
    }
  };

  // First pass shortly after boot, then on the interval.
  setTimeout(run, 15000);
  const timer = setInterval(run, INTERVAL_MS);
  if (timer.unref) timer.unref(); // don't keep the process alive on its own
  console.log(
    `📧 Gmail auto-sync started (every ${INTERVAL_MS}ms, concurrency ${CONCURRENCY}, ${isProd ? "prod reconciliation" : "dev primary"})`
  );
  return timer;
}

/**
 * Process a single Gmail message: fetch it, check if it's from a tracked contact,
 * and store it in the database if not already present.
 */
async function processGmailMessage(gmail, msgId, userId, emailAddress, Message, TrackedContact, Client, sequenceModels = null) {
  try {
    // Check if we already have this message
    const existing = await Message.findOne({ externalId: msgId });
    if (existing) {
      // Backfill attachments for messages synced before attachment support
      if (!existing.attachments || existing.attachments.length === 0) {
        try {
          const msgResponse = await gmail.users.messages.get({
            userId: "me",
            id: msgId,
            format: "full",
          });
          const attachments = extractAttachments(msgResponse.data.payload, msgId);
          if (attachments.length > 0) {
            existing.attachments = attachments;
            await existing.save();
            console.log(`📎 Backfilled ${attachments.length} attachment(s) for message ${msgId}`);
          }
        } catch {
          // non-critical, skip
        }
      }
      return false;
    }

    // Fetch full message
    const msgResponse = await gmail.users.messages.get({
      userId: "me",
      id: msgId,
      format: "full",
    });

    const msg = msgResponse.data;
    const headers = msg.payload.headers || [];

    const getHeader = (name) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

    const from = getHeader("From");
    const to = getHeader("To");
    const subject = getHeader("Subject");
    const dateHeader = getHeader("Date");

    // Determine direction
    const isOutbound = from.toLowerCase().includes(emailAddress.toLowerCase());
    const contactEmail = isOutbound ? extractEmail(to) : extractEmail(from);
    const contactName = isOutbound ? extractName(to) : extractName(from);

    if (!contactEmail) return false;

    // Match against tracked contacts or clients
    const trackedContact = await TrackedContact.findOne({
      userId,
      email: contactEmail.toLowerCase(),
    });

    const client = await Client.findOne({
      userId,
      email: contactEmail.toLowerCase(),
    });

    // Only store messages from tracked contacts or clients
    if (!trackedContact && !client) {
      return false;
    }

    // Extract body text
    const body = extractBody(msg.payload);

    // Extract attachment metadata
    const attachments = extractAttachments(msg.payload, msgId);

    const newMessage = new Message({
      userId,
      channel: "gmail",
      contactId: trackedContact?._id || client?._id || null,
      contactName: contactName || trackedContact?.name || client?.name || contactEmail,
      contactIdentifier: contactEmail,
      externalId: msgId,
      threadId: msg.threadId,
      direction: isOutbound ? "outbound" : "inbound",
      body,
      subject,
      status: "delivered",
      timestamp: dateHeader ? new Date(dateHeader) : new Date(),
      rawPayload: { id: msgId, threadId: msg.threadId, labelIds: msg.labelIds },
      attachments,
    });

    await newMessage.save();

    // Push to any open inbox tabs for this user so the message appears live.
    publish(userId, {
      type: "new-message",
      channel: "gmail",
      direction: isOutbound ? "outbound" : "inbound",
      contactIdentifier: contactEmail,
    });

    // Inbound reply → wake any sequence enrollment waiting on a reply from this contact.
    if (!isOutbound && sequenceModels) {
      wakeAwaitingReply(sequenceModels, userId, contactEmail).catch(() => {});
    }

    return true;
  } catch (msgErr) {
    console.error(`⚠️ Error processing Gmail message ${msgId}:`, msgErr.message);
    return false;
  }
}

/* ─── Helpers ─── */

function extractEmail(headerValue) {
  const match = headerValue.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : headerValue.trim().toLowerCase();
}

function extractName(headerValue) {
  const match = headerValue.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : "";
}

function extractBody(payload) {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf8");
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64").toString("utf8");
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = Buffer.from(part.body.data, "base64").toString("utf8");
        return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      }
    }
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }

  return "";
}

/**
 * Recursively extract attachment metadata from Gmail message payload parts.
 */
function extractAttachments(payload, messageId) {
  const attachments = [];

  function walkParts(parts) {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || "application/octet-stream",
          size: part.body.size || 0,
          attachmentId: part.body.attachmentId,
        });
      }
      if (part.parts) {
        walkParts(part.parts);
      }
    }
  }

  walkParts(payload.parts);
  return attachments;
}
