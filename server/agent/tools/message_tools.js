import { z } from "zod";
import mongoose from "mongoose";
import { createGmailClient } from "../../utils/gmailClient.js";
import { decrypt } from "../../utils/encryption.js";
import { syncGmailMessages } from "../../utils/gmailSync.js";

function toObjectId(s) { return new mongoose.Types.ObjectId(s); }

function projectMessage(m) {
  return {
    id: String(m._id),
    channel: m.channel,
    direction: m.direction,
    subject: m.subject || null,
    body: (m.body || "").slice(0, 800),
    timestamp: m.timestamp,
    status: m.status,
    hasAttachments: (m.attachments?.length || 0) > 0,
  };
}

export default function registerMessageTools(registry, { Connection, Message, TrackedContact, Client }) {

  registry.register({
    category: "messages",
    name: "sync_gmail",
    description: "Pull new Gmail messages for tracked contacts on-demand. No-op (returns 0) if Gmail isn't connected.",
    creditCost: 2,
    sensitive: false,
    schema: z.object({}),
    handler: async (_a, userId) => {
      const conn = await Connection.findOne({ userId, channel: "gmail", status: "connected" });
      if (!conn) return { success: true, connected: false, newMessages: 0 };
      const newCount = await syncGmailMessages(conn, Message, TrackedContact, Client);
      return { success: true, connected: true, newMessages: newCount };
    },
  });

  registry.register({
    category: "messages",
    name: "list_conversations",
    description: "Group all messages into conversations per contact, with unread counts and last-message previews. Optionally filter by channel.",
    creditCost: 1,
    sensitive: false,
    schema: z.object({
      channel: z.enum(["all", "gmail", "whatsapp"]).optional(),
      limit:   z.number().int().min(1).max(100).optional(),
    }),
    handler: async (a, userId) => {
      const match = { userId: toObjectId(userId) };
      if (a.channel && a.channel !== "all") match.channel = a.channel;

      const rows = await Message.aggregate([
        { $match: match },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: "$contactIdentifier",
            contactName: { $first: "$contactName" },
            contactIdentifier: { $first: "$contactIdentifier" },
            channel: { $first: "$channel" },
            lastMessage: { $first: "$body" },
            lastSubject: { $first: "$subject" },
            lastTime: { $first: "$timestamp" },
            threadId: { $first: "$threadId" },
            messageCount: { $sum: 1 },
            unreadCount: {
              $sum: { $cond: [{ $and: [{ $eq: ["$direction", "inbound"] }, { $ne: ["$status", "read"] }] }, 1, 0] },
            },
          },
        },
        { $sort: { lastTime: -1 } },
        { $limit: a.limit || 30 },
      ]);

      return {
        count: rows.length,
        conversations: rows.map((c) => ({
          contactName: c.contactName,
          contactIdentifier: c.contactIdentifier,
          channel: c.channel,
          threadId: c.threadId,
          lastSubject: c.lastSubject,
          lastMessage: (c.lastMessage || "").slice(0, 200),
          lastTime: c.lastTime,
          messageCount: c.messageCount,
          unreadCount: c.unreadCount,
        })),
      };
    },
  });

  registry.register({
    category: "messages",
    name: "get_unread_count",
    description: "Total number of unread inbound messages across all channels.",
    creditCost: 1,
    sensitive: false,
    schema: z.object({}),
    handler: async (_a, userId) => {
      const unreadCount = await Message.countDocuments({
        userId: toObjectId(userId),
        direction: "inbound",
        status: { $ne: "read" },
      });
      return { unreadCount };
    },
  });

  registry.register({
    category: "messages",
    name: "get_conversation",
    description: "Read the full message history with a specific contact (by email or phone).",
    creditCost: 1,
    sensitive: false,
    schema: z.object({
      contactIdentifier: z.string().describe("Email address or phone number"),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    handler: async (a, userId) => {
      const rows = await Message.find({
        userId: toObjectId(userId),
        contactIdentifier: a.contactIdentifier,
      }).sort({ timestamp: 1 }).limit(a.limit || 50).lean();
      return {
        contactIdentifier: a.contactIdentifier,
        count: rows.length,
        messages: rows.map(projectMessage),
      };
    },
  });

  registry.register({
    category: "messages",
    name: "mark_conversation_read",
    description: "Mark all inbound messages from a contact as read.",
    creditCost: 1,
    sensitive: false,
    schema: z.object({
      contactIdentifier: z.string(),
    }),
    handler: async (a, userId) => {
      const r = await Message.updateMany(
        {
          userId: toObjectId(userId),
          contactIdentifier: a.contactIdentifier,
          direction: "inbound",
          status: { $ne: "read" },
        },
        { $set: { status: "read" } },
      );
      return { success: true, markedRead: r.modifiedCount };
    },
  });

  registry.register({
    category: "messages",
    name: "send_email",
    description: "Send a Gmail email. Always draft the full body in your reply text BEFORE calling this — the confirmation card will show the preview.",
    creditCost: 3,
    sensitive: true,
    buildDescription: (a) =>
      `📧 Send **email** to **${a.to}**${a.subject ? ` — subject: _${a.subject}_` : ""}\n\n---\n${a.body}\n---`,
    schema: z.object({
      to:      z.string().email().describe("Recipient email"),
      subject: z.string().optional(),
      body:    z.string().min(1),
      threadId:    z.string().optional().describe("Gmail thread id when replying"),
      contactName: z.string().optional(),
    }),
    handler: async (a, userId) => {
      const conn = await Connection.findOne({ userId, channel: "gmail", status: "connected" });
      if (!conn) throw new Error("Gmail is not connected. Open Settings → Integrations to connect it.");

      const { gmail } = createGmailClient(conn);
      const subject = a.subject || "(no subject)";
      const raw = Buffer.from(
        [
          `To: ${a.to}`,
          `From: ${conn.gmailEmail}`,
          `Subject: ${subject}`,
          "Content-Type: text/plain; charset=utf-8",
          "",
          a.body,
        ].join("\r\n"),
      ).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

      const reqBody = { raw };
      if (a.threadId) reqBody.threadId = a.threadId;
      const sent = await gmail.users.messages.send({ userId: "me", requestBody: reqBody });

      const stored = await Message.create({
        userId,
        channel: "gmail",
        contactIdentifier: a.to,
        contactName: a.contactName || a.to,
        externalId: sent.data.id,
        threadId: sent.data.threadId || a.threadId,
        direction: "outbound",
        body: a.body,
        subject,
        status: "delivered",
        timestamp: new Date(),
      });

      return { success: true, channel: "gmail", to: a.to, subject, messageId: String(stored._id) };
    },
  });

  registry.register({
    category: "messages",
    name: "send_whatsapp",
    description: "Send a WhatsApp text message via the Cloud API. Always draft the full body in your reply text BEFORE calling this.",
    creditCost: 3,
    sensitive: true,
    buildDescription: (a) =>
      `💬 Send **WhatsApp** message to **${a.to}**\n\n---\n${a.body}\n---`,
    schema: z.object({
      to:   z.string().describe("Phone number in E.164 (e.g. +14155551234)"),
      body: z.string().min(1),
      contactName: z.string().optional(),
    }),
    handler: async (a, userId) => {
      const conn = await Connection.findOne({ userId, channel: "whatsapp", status: "connected" });
      if (!conn) throw new Error("WhatsApp is not connected. Open Settings → Integrations to connect it.");

      const token = decrypt(conn.waAccessToken);
      const res = await fetch(`https://graph.facebook.com/v21.0/${conn.waPhoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: a.to,
          type: "text",
          text: { body: a.body },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || "WhatsApp send failed");
      }
      const data = await res.json();

      const stored = await Message.create({
        userId,
        channel: "whatsapp",
        contactIdentifier: a.to,
        contactName: a.contactName || a.to,
        externalId: data.messages?.[0]?.id || null,
        threadId: a.to,
        direction: "outbound",
        body: a.body,
        status: "delivered",
        timestamp: new Date(),
      });
      return { success: true, channel: "whatsapp", to: a.to, messageId: String(stored._id) };
    },
  });

  registry.register({
    category: "messages",
    name: "delete_message",
    description: "Permanently delete a single message by id.",
    creditCost: 2,
    sensitive: true,
    buildDescription: (a) => `Delete message \`${a.messageId}\` — proceed?`,
    schema: z.object({ messageId: z.string() }),
    handler: async ({ messageId }, userId) => {
      if (!mongoose.isValidObjectId(messageId)) throw new Error("Invalid messageId");
      const m = await Message.findOneAndDelete({ _id: messageId, userId });
      if (!m) throw new Error("Message not found.");
      return { success: true };
    },
  });

  registry.register({
    category: "messages",
    name: "delete_conversation",
    description: "Permanently delete ALL messages with a contact (Gmail + WhatsApp combined).",
    creditCost: 3,
    sensitive: true,
    buildDescription: (a) =>
      `**Permanently delete every message** with **${a.contactIdentifier}**. This cannot be undone. Proceed?`,
    schema: z.object({ contactIdentifier: z.string() }),
    handler: async (a, userId) => {
      const r = await Message.deleteMany({ userId, contactIdentifier: a.contactIdentifier });
      return { success: true, deletedCount: r.deletedCount };
    },
  });
}
