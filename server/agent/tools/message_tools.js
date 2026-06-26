import { z } from "zod";
import mongoose from "mongoose";
import { syncGmailMessages } from "../../utils/gmailSync.js";
import { sendEmail, sendWhatsApp } from "../../sequences/senders.js";

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
      const r = await sendEmail({ Connection, Message }, userId, a);
      return { success: true, channel: "gmail", to: a.to, subject: r.subject, messageId: r.messageId };
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
      const r = await sendWhatsApp({ Connection, Message }, userId, a);
      return { success: true, channel: "whatsapp", to: a.to, messageId: r.messageId };
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
