import express from "express";
import crypto from "crypto";
import { wakeAwaitingReply } from "../sequences/engine.js";
import { syncGmailMessages } from "../utils/gmailSync.js";
import { publish } from "../utils/realtime.js";

// Escape special regex characters to prevent ReDoS
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Verify Meta's X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret).
 * Enforced (fail closed) whenever WHATSAPP_APP_SECRET is configured; if it isn't set we
 * warn and allow, so an existing/dev setup keeps working until the secret is added.
 */
function verifyMetaSignature(req) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    console.warn("⚠️ WHATSAPP_APP_SECRET not set — inbound WhatsApp webhooks are UNVERIFIED. Set it to enforce.");
    return true;
  }
  const sig = req.get("x-hub-signature-256");
  if (!sig || !req.rawBody) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false; // length mismatch / malformed header
  }
}

/**
 * Verify a shared secret on the Gmail Pub/Sub push. Configure the subscription's push
 * endpoint as .../api/webhooks/gmail?token=<GMAIL_PUBSUB_TOKEN>. Enforced when the env
 * var is set; warns and allows otherwise so the current setup isn't broken.
 */
function verifyPubSubToken(req) {
  const expected = process.env.GMAIL_PUBSUB_TOKEN;
  if (!expected) {
    console.warn("⚠️ GMAIL_PUBSUB_TOKEN not set — Gmail Pub/Sub webhook is UNVERIFIED. Set it to enforce.");
    return true;
  }
  return req.query.token === expected;
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
      // Reject spoofed callers before doing any work (when a token is configured).
      if (!verifyPubSubToken(req)) {
        return res.status(401).send("Unauthorized");
      }

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
      // Reject forged inbound messages before doing any work (when the app secret is set).
      if (!verifyMetaSignature(req)) {
        return res.status(401).send("Invalid signature");
      }

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
              // Check if we already stored this message
              const existing = await Message.findOne({ externalId: msg.id });
              if (existing) continue;

              const senderPhone = msg.from; // e.g. "15551234567"

              // Derive a display body. Text comes through as-is; every other
              // type gets a lightweight placeholder so the conversation still
              // shows up in the inbox (full media rendering is future work).
              let messageBody;
              switch (msg.type) {
                case "text":
                  messageBody = msg.text?.body || "";
                  break;
                case "image":
                  messageBody = msg.image?.caption || "📷 Photo";
                  break;
                case "video":
                  messageBody = msg.video?.caption || "🎥 Video";
                  break;
                case "audio":
                  messageBody = "🎤 Voice message";
                  break;
                case "document":
                  messageBody = msg.document?.filename
                    ? `📎 ${msg.document.filename}`
                    : "📎 Document";
                  break;
                case "sticker":
                  messageBody = "💟 Sticker";
                  break;
                case "location":
                  messageBody = "📍 Location";
                  break;
                case "contacts":
                  messageBody = "👤 Contact card";
                  break;
                case "button":
                  messageBody = msg.button?.text || "Button reply";
                  break;
                case "interactive":
                  messageBody =
                    msg.interactive?.button_reply?.title ||
                    msg.interactive?.list_reply?.title ||
                    "Interactive reply";
                  break;
                case "reaction":
                  messageBody = msg.reaction?.emoji
                    ? `Reacted ${msg.reaction.emoji}`
                    : "Reaction";
                  break;
                default:
                  messageBody = `[${msg.type} message]`;
              }

              // Get contact name from the contacts array
              const contactInfo = value.contacts?.find(
                (c) => c.wa_id === senderPhone
              );
              const senderName = contactInfo?.profile?.name || senderPhone;

              // Enrich with a tracked contact / client when the sender matches
              // by the last 10 digits of their phone — but store the message
              // either way so the inbox shows every inbound conversation, just
              // like Gmail does for email from anyone.
              const phoneTail = senderPhone.slice(-10);
              const trackedContact = await TrackedContact.findOne({
                userId,
                phone: { $regex: escapeRegex(phoneTail), $options: "i" },
              });

              // Also check clients
              const client = await Client.findOne({
                userId,
                phone: { $regex: escapeRegex(phoneTail), $options: "i" },
              });

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
