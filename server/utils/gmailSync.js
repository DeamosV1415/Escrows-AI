import { createGmailClient } from "./gmailClient.js";

/**
 * Sync new Gmail messages for a given connection.
 * Uses Gmail history API if a historyId is stored, otherwise does an initial sync
 * of the last 20 inbox messages.
 *
 * @param {Object} connection - The Connection mongoose document
 * @param {Object} Message - The Message mongoose model
 * @param {Object} TrackedContact - The TrackedContact mongoose model
 * @param {Object} Client - The Client mongoose model
 * @returns {number} Number of new messages stored
 */
export async function syncGmailMessages(connection, Message, TrackedContact, Client) {
  const userId = connection.userId;
  const emailAddress = connection.gmailEmail;

  let gmail;
  try {
    ({ gmail } = createGmailClient(connection));
  } catch (err) {
    console.error(`❌ Gmail client creation failed for ${emailAddress}:`, err.message);
    return 0;
  }

  let newCount = 0;
  const previousHistoryId = connection.gmailHistoryId;

  // ─── Strategy 1: Use History API (incremental sync) ───
  if (previousHistoryId) {
    try {
      const historyResponse = await gmail.users.history.list({
        userId: "me",
        startHistoryId: previousHistoryId,
        historyTypes: ["messageAdded"],
        labelId: "INBOX",
      });

      const histories = historyResponse.data.history || [];

      // Update historyId from profile
      const profile = await gmail.users.getProfile({ userId: "me" });
      connection.gmailHistoryId = profile.data.historyId;
      await connection.save();

      if (histories.length === 0) {
        return 0;
      }

      // Collect new message IDs
      const messageIds = new Set();
      for (const h of histories) {
        if (h.messagesAdded) {
          for (const ma of h.messagesAdded) {
            messageIds.add(ma.message.id);
          }
        }
      }

      console.log(`📬 Gmail sync: ${messageIds.size} new message(s) for ${emailAddress}`);

      for (const msgId of messageIds) {
        const stored = await processGmailMessage(
          gmail, msgId, userId, emailAddress, Message, TrackedContact, Client
        );
        if (stored) newCount++;
      }

      return newCount;
    } catch (histErr) {
      if (histErr.code === 404 || histErr.code === 400) {
        // historyId expired/invalid — fall through to initial sync
        console.log("⚠️ Gmail history expired, falling back to initial sync");
      } else {
        console.error(`❌ Gmail history sync failed for ${emailAddress}:`, histErr.message);
        return 0;
      }
    }
  }

  // ─── Strategy 2: Initial sync (fetch last 20 inbox messages) ───
  try {
    console.log(`📥 Gmail initial sync for ${emailAddress}...`);

    const listResponse = await gmail.users.messages.list({
      userId: "me",
      maxResults: 20,
      labelIds: ["INBOX"],
    });

    const messages = listResponse.data.messages || [];

    // Update historyId for future incremental syncs
    const profile = await gmail.users.getProfile({ userId: "me" });
    connection.gmailHistoryId = profile.data.historyId;
    await connection.save();

    for (const msg of messages) {
      const stored = await processGmailMessage(
        gmail, msg.id, userId, emailAddress, Message, TrackedContact, Client
      );
      if (stored) newCount++;
    }

    console.log(`✅ Gmail initial sync complete: ${newCount} new messages stored for ${emailAddress}`);
    return newCount;
  } catch (err) {
    console.error(`❌ Gmail initial sync failed for ${emailAddress}:`, err.message);
    return 0;
  }
}

/**
 * Process a single Gmail message: fetch it, check if it's from a tracked contact,
 * and store it in the database if not already present.
 */
async function processGmailMessage(gmail, msgId, userId, emailAddress, Message, TrackedContact, Client) {
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
