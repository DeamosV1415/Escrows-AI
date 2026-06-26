import express from "express";
import { wakeAwaitingReply } from "../sequences/engine.js";
import { syncGmailMessages } from "../utils/gmailSync.js";
import { publish } from "../utils/realtime.js";

// Escape special regex characters to prevent ReDoS
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Webhook routes for external services (Gmail Pub/Sub, WhatsApp).
 * These routes do NOT use authMiddleware since they're called by external services.
 */
export default function createWebhooksRouter(Connection, Message, TrackedContact, Client, sequenceModels) {
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

      // Delegate to the shared, idempotent sync. It re-scans the recent INBOX
      // window (deduped by externalId), so it reliably picks up the new message
      // the notification is about — without the History-API cursor races that
      // previously dropped messages. Inbound replies wake sequences via
      // sequenceModels passed through to processGmailMessage.
      const newCount = await syncGmailMessages(
        connection, Message, TrackedContact, Client, sequenceModels
      );
      if (newCount > 0) {
        console.log(`📬 Gmail webhook: ${newCount} new message(s) stored for ${emailAddress}`);
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

              // Push to any open inbox tabs for this user so it appears live.
              publish(userId, {
                type: "new-message",
                channel: "whatsapp",
                direction: "inbound",
                contactIdentifier: senderPhone,
              });

              // Inbound reply → wake any sequence enrollment waiting on a reply.
              if (sequenceModels) {
                wakeAwaitingReply(sequenceModels, userId, senderPhone).catch(() => {});
              }
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
