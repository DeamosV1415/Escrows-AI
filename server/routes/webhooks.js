import express from "express";
import { createGmailClient } from "../utils/gmailClient.js";

// Escape special regex characters to prevent ReDoS
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Webhook routes for external services (Gmail Pub/Sub, WhatsApp).
 * These routes do NOT use authMiddleware since they're called by external services.
 */
export default function createWebhooksRouter(Connection, Message, TrackedContact, Client) {
  const router = express.Router();

  // ─── POST /api/webhooks/gmail ───
  // Google Pub/Sub push endpoint for Gmail notifications
  router.post("/gmail", async (req, res) => {
    try {
      // Acknowledge immediately (Google expects 2xx within 20s)
      res.status(200).send("OK");

      const { message } = req.body;
      if (!message || !message.data) {
        console.log("⚠️ Gmail webhook: no message data");
        return;
      }

      // Decode the Pub/Sub message
      const data = JSON.parse(
        Buffer.from(message.data, "base64").toString("utf8")
      );
      const { emailAddress, historyId } = data;

      if (!emailAddress || !historyId) {
        console.log("⚠️ Gmail webhook: missing emailAddress or historyId");
        return;
      }

      console.log(`📨 Gmail webhook: ${emailAddress}, historyId: ${historyId}`);

      // Find the connection for this email
      const connection = await Connection.findOne({
        gmailEmail: emailAddress,
        channel: "gmail",
        status: "connected",
      }).sort({ updatedAt: -1 });

      if (!connection) {
        console.log(`⚠️ Gmail webhook: no connection found for ${emailAddress}`);
        return;
      }

      const userId = connection.userId;
      const previousHistoryId = connection.gmailHistoryId;

      if (!previousHistoryId) {
        console.log("⚠️ Gmail webhook: no previousHistoryId stored, skipping");
        connection.gmailHistoryId = historyId;
        await connection.save();
        return;
      }

      // Fetch history since last known historyId
      const { gmail } = createGmailClient(connection);

      try {
        const historyResponse = await gmail.users.history.list({
          userId: "me",
          startHistoryId: previousHistoryId,
          historyTypes: ["messageAdded"],
          labelId: "INBOX",
        });

        // Update stored historyId
        connection.gmailHistoryId = historyId;
        await connection.save();

        const histories = historyResponse.data.history || [];
        if (histories.length === 0) {
          console.log("📭 Gmail webhook: no new messages in history");
          return;
        }

        // Collect all new message IDs
        const messageIds = new Set();
        for (const h of histories) {
          if (h.messagesAdded) {
            for (const ma of h.messagesAdded) {
              messageIds.add(ma.message.id);
            }
          }
        }

        console.log(`📬 Gmail webhook: ${messageIds.size} new message(s) to process`);

        // Process each message
        for (const msgId of messageIds) {
          try {
            // Check if we already have this message
            const existing = await Message.findOne({ externalId: msgId });
            if (existing) continue;

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

            // Determine direction: if "From" matches our connected email, it's outbound
            const isOutbound = from.toLowerCase().includes(emailAddress.toLowerCase());
            const contactEmail = isOutbound
              ? extractEmail(to)
              : extractEmail(from);
            const contactName = isOutbound
              ? extractName(to)
              : extractName(from);

            if (!contactEmail) continue;

            // Match against tracked contacts for this user
            const trackedContact = await TrackedContact.findOne({
              userId,
              email: contactEmail.toLowerCase(),
            });

            // Also check if they're a Client
            const client = await Client.findOne({
              userId,
              email: contactEmail.toLowerCase(),
            });

            // Only store messages from tracked contacts or clients
            if (!trackedContact && !client) {
              continue;
            }

            // Extract body text
            const body = extractBody(msg.payload);

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
            });

            await newMessage.save();
            console.log(
              `💾 Stored ${isOutbound ? "outbound" : "inbound"} Gmail message from ${contactEmail}`
            );
          } catch (msgErr) {
            console.error(`⚠️ Error processing message ${msgId}:`, msgErr.message);
          }
        }
      } catch (histErr) {
        if (histErr.code === 404) {
          // historyId too old, need a full sync
          console.log("⚠️ Gmail history expired, updating historyId");
          connection.gmailHistoryId = historyId;
          await connection.save();
        } else {
          throw histErr;
        }
      }
    } catch (err) {
      console.error("Gmail webhook error:", err.message);
      // Already sent 200, so just log
    }
  });

  // ═══════════════════════════════════════════════
  //  WhatsApp Webhooks
  // ═══════════════════════════════════════════════

  // ─── GET /api/webhooks/whatsapp ───
  // Meta webhook verification challenge
  router.get("/whatsapp", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log("✅ WhatsApp webhook verified");
      return res.status(200).send(challenge);
    }

    console.log("❌ WhatsApp webhook verification failed");
    res.status(403).send("Forbidden");
  });

  // ─── POST /api/webhooks/whatsapp ───
  // Incoming WhatsApp messages
  router.post("/whatsapp", async (req, res) => {
    try {
      // Acknowledge immediately (Meta expects 200 within 20s)
      res.status(200).send("EVENT_RECEIVED");

      const body = req.body;

      if (body.object !== "whatsapp_business_account") return;

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field !== "messages") continue;

          const value = change.value;
          if (!value || !value.messages) continue;

          const phoneNumberId = value.metadata?.phone_number_id;
          if (!phoneNumberId) continue;

          // Find which user's connection this belongs to
          const connection = await Connection.findOne({
            waPhoneNumberId: phoneNumberId,
            channel: "whatsapp",
            status: "connected",
          });

          if (!connection) {
            console.log(`⚠️ WhatsApp webhook: no connection for phone ${phoneNumberId}`);
            continue;
          }

          const userId = connection.userId;

          for (const msg of value.messages) {
            try {
              // Skip non-text messages for now
              if (msg.type !== "text") {
                console.log(`⏭️ WhatsApp webhook: skipping ${msg.type} message`);
                continue;
              }

              // Check if we already stored this message
              const existing = await Message.findOne({ externalId: msg.id });
              if (existing) continue;

              const senderPhone = msg.from; // e.g. "15551234567"
              const messageBody = msg.text?.body || "";

              // Get contact name from the contacts array
              const contactInfo = value.contacts?.find(
                (c) => c.wa_id === senderPhone
              );
              const senderName = contactInfo?.profile?.name || senderPhone;

              // Match against tracked contacts
              const trackedContact = await TrackedContact.findOne({
                userId,
                phone: { $regex: escapeRegex(senderPhone.slice(-10)), $options: "i" },
              });

              // Also check clients
              const client = await Client.findOne({
                userId,
                phone: { $regex: escapeRegex(senderPhone.slice(-10)), $options: "i" },
              });

              // Only store messages from tracked contacts or clients
              if (!trackedContact && !client) {
                console.log(`⏭️ WhatsApp: untracked sender ${senderPhone}, skipping`);
                continue;
              }

              const newMessage = new Message({
                userId,
                channel: "whatsapp",
                contactId: trackedContact?._id || client?._id || null,
                contactName: trackedContact?.name || client?.name || senderName,
                contactIdentifier: senderPhone,
                externalId: msg.id,
                threadId: senderPhone, // Use phone number as thread ID
                direction: "inbound",
                body: messageBody,
                status: "delivered",
                timestamp: new Date(parseInt(msg.timestamp) * 1000),
              });

              await newMessage.save();
              console.log(`💾 WhatsApp message stored from ${senderPhone}`);
            } catch (msgErr) {
              console.error("⚠️ Error processing WhatsApp message:", msgErr.message);
            }
          }
        }
      }
    } catch (err) {
      console.error("WhatsApp webhook error:", err.message);
    }
  });

  return router;
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
  // Try to get plain text body
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf8");
  }

  // Check parts recursively
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64").toString("utf8");
      }
    }
    // Fallback to HTML if no plain text
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = Buffer.from(part.body.data, "base64").toString("utf8");
        // Basic HTML stripping
        return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      }
    }
    // Check nested parts (multipart/alternative inside multipart/mixed)
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }

  return "";
}
