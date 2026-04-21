import express from "express";
import mongoose from "mongoose";
import { createGmailClient } from "../utils/gmailClient.js";
import { decrypt } from "../utils/encryption.js";
import { syncGmailMessages } from "../utils/gmailSync.js";

export default function createMessagesRouter(Connection, Message, TrackedContact, Client) {
  const router = express.Router();

  // ─── POST /api/messages/sync ───
  // Trigger an on-demand Gmail sync for the current user
  router.post("/sync", async (req, res) => {
    try {
      const connection = await Connection.findOne({
        userId: req.userId,
        channel: "gmail",
        status: "connected",
      });

      if (!connection) {
        return res.json({ success: true, newMessages: 0, message: "Gmail not connected." });
      }

      const newCount = await syncGmailMessages(connection, Message, TrackedContact, Client);
      res.json({ success: true, newMessages: newCount });
    } catch (err) {
      console.error("Sync error:", err.message);
      res.status(500).json({ error: "Sync failed." });
    }
  });

  // ─── GET /api/messages/conversations ───
  // List conversations grouped by contact for the logged-in user
  router.get("/conversations", async (req, res) => {
    try {
      const userId = req.userId;
      const { channel } = req.query;

      const matchStage = { userId: userId };
      if (channel && channel !== "all") {
        matchStage.channel = channel;
      }

      // Aggregate messages grouped by contactIdentifier
      const conversations = await Message.aggregate([
        { $match: matchStage },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: "$contactIdentifier",
            contactName: { $first: "$contactName" },
            contactIdentifier: { $first: "$contactIdentifier" },
            channel: { $first: "$channel" },
            contactId: { $first: "$contactId" },
            lastMessage: { $first: "$body" },
            lastSubject: { $first: "$subject" },
            lastTime: { $first: "$timestamp" },
            threadId: { $first: "$threadId" },
            messageCount: { $sum: 1 },
            unreadCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$direction", "inbound"] },
                      { $ne: ["$status", "read"] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $sort: { lastTime: -1 } },
      ]);

      const objectUserId = new mongoose.Types.ObjectId(userId);

      const conversationsWithUserId = await Message.aggregate([
        { $match: { ...matchStage, userId: objectUserId } },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: "$contactIdentifier",
            contactName: { $first: "$contactName" },
            contactIdentifier: { $first: "$contactIdentifier" },
            channel: { $first: "$channel" },
            contactId: { $first: "$contactId" },
            lastMessage: { $first: "$body" },
            lastSubject: { $first: "$subject" },
            lastTime: { $first: "$timestamp" },
            threadId: { $first: "$threadId" },
            messageCount: { $sum: 1 },
            unreadCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$direction", "inbound"] },
                      { $ne: ["$status", "read"] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $sort: { lastTime: -1 } },
      ]);

      res.json(conversationsWithUserId);
    } catch (err) {
      console.error("Error fetching conversations:", err.message);
      res.status(500).json({ error: "Failed to fetch conversations." });
    }
  });

  // ─── GET /api/messages/unread-count ───
  // Return total unread message count for sidebar badge
  router.get("/unread-count", async (req, res) => {
    try {
      const count = await Message.countDocuments({
        userId: new mongoose.Types.ObjectId(req.userId),
        direction: "inbound",
        status: { $ne: "read" },
      });
      res.json({ unreadCount: count });
    } catch (err) {
      console.error("Error fetching unread count:", err.message);
      res.status(500).json({ error: "Failed to fetch unread count." });
    }
  });

  // ─── PATCH /api/messages/read/:contactIdentifier ───
  // Mark all inbound messages from a contact as "read"
  router.patch("/read/:contactIdentifier", async (req, res) => {
    try {
      const objectUserId = new mongoose.Types.ObjectId(req.userId);
      const result = await Message.updateMany(
        {
          userId: objectUserId,
          contactIdentifier: req.params.contactIdentifier,
          direction: "inbound",
          status: { $ne: "read" },
        },
        { $set: { status: "read" } },
      );

      console.log(
        `✉️ Marked ${result.modifiedCount} messages as read for ${req.params.contactIdentifier}`
      );
      res.json({ success: true, modifiedCount: result.modifiedCount });
    } catch (err) {
      console.error("Error marking messages as read:", err.message);
      res.status(500).json({ error: "Failed to mark messages as read." });
    }
  });

  // ─── GET /api/messages/:contactId ───
  // Get messages for a specific contact
  router.get("/:contactIdentifier", async (req, res) => {
    try {
      const messages = await Message.find({
        userId: req.userId,
        contactIdentifier: req.params.contactIdentifier,
      })
        .sort({ timestamp: 1 })
        .lean();

      res.json(messages);
    } catch (err) {
      console.error("Error fetching messages:", err.message);
      res.status(500).json({ error: "Failed to fetch messages." });
    }
  });

  // ─── POST /api/messages/send ───
  // Send a reply via Gmail API
  router.post("/send", async (req, res) => {
    try {
      const { contactIdentifier, body, subject, channel, threadId } = req.body;

      if (!contactIdentifier || !body) {
        return res
          .status(400)
          .json({ error: "contactIdentifier and body are required." });
      }

      if (channel !== "gmail" && channel !== "whatsapp") {
        return res
          .status(400)
          .json({ error: `Channel "${channel}" is not yet supported for sending.` });
      }

      // ─── WhatsApp Send ───
      if (channel === "whatsapp") {
        const waConnection = await Connection.findOne({
          userId: req.userId,
          channel: "whatsapp",
          status: "connected",
        });

        if (!waConnection) {
          return res
            .status(400)
            .json({ error: "WhatsApp is not connected. Please connect WhatsApp first." });
        }

        const waToken = decrypt(waConnection.waAccessToken);
        const phoneNumberId = waConnection.waPhoneNumberId;

        // Send via WhatsApp Cloud API
        const waRes = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${waToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: contactIdentifier,
              type: "text",
              text: { body },
            }),
          }
        );

        if (!waRes.ok) {
          const errData = await waRes.json().catch(() => ({}));
          const errMsg = errData.error?.message || "WhatsApp send failed";
          return res.status(500).json({ error: errMsg });
        }

        const waData = await waRes.json();
        const waMessageId = waData.messages?.[0]?.id || null;

        const sentMessage = new Message({
          userId: req.userId,
          channel: "whatsapp",
          contactIdentifier,
          contactName: req.body.contactName || contactIdentifier,
          externalId: waMessageId,
          threadId: contactIdentifier,
          direction: "outbound",
          body,
          status: "delivered",
          timestamp: new Date(),
        });

        await sentMessage.save();

        console.log(`📤 WhatsApp message sent to ${contactIdentifier} by user ${req.userId}`);
        return res.json({ success: true, message: sentMessage.toObject() });
      }

      // Get the user's Gmail connection
      const connection = await Connection.findOne({
        userId: req.userId,
        channel: "gmail",
        status: "connected",
      });

      if (!connection) {
        return res
          .status(400)
          .json({ error: "Gmail is not connected. Please connect Gmail first." });
      }

      const { gmail } = createGmailClient(connection);

      // Build the email
      const emailSubject = subject || "Re: (no subject)";
      const emailLines = [
        `To: ${contactIdentifier}`,
        `From: ${connection.gmailEmail}`,
        `Subject: ${emailSubject}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
      ];

      const rawEmail = Buffer.from(emailLines.join("\r\n"))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const sendParams = {
        userId: "me",
        requestBody: { raw: rawEmail },
      };

      // If replying in a thread, include threadId
      if (threadId) {
        sendParams.requestBody.threadId = threadId;
      }

      const sentResponse = await gmail.users.messages.send(sendParams);

      // Store the sent message in our DB
      const sentMessage = new Message({
        userId: req.userId,
        channel: "gmail",
        contactIdentifier,
        contactName: req.body.contactName || contactIdentifier,
        externalId: sentResponse.data.id,
        threadId: sentResponse.data.threadId || threadId,
        direction: "outbound",
        body,
        subject: emailSubject,
        status: "delivered",
        timestamp: new Date(),
      });

      await sentMessage.save();

      console.log(
        `📤 Gmail reply sent to ${contactIdentifier} by user ${req.userId}`
      );
      res.json({
        success: true,
        message: sentMessage.toObject(),
      });
    } catch (err) {
      console.error("Error sending message:", err.message);
      res.status(500).json({ error: "Failed to send message." });
    }
  });

  // ─── DELETE /api/messages/conversation/:contactIdentifier ───
  // Delete an entire conversation (all messages with a contact)
  router.delete("/conversation/:contactIdentifier", async (req, res) => {
    try {
      const result = await Message.deleteMany({
        userId: req.userId,
        contactIdentifier: req.params.contactIdentifier,
      });

      console.log(
        `🗑️ Deleted conversation (${result.deletedCount} messages) with ${req.params.contactIdentifier} for user ${req.userId}`
      );
      res.json({
        success: true,
        deletedCount: result.deletedCount,
      });
    } catch (err) {
      console.error("Error deleting conversation:", err.message);
      res.status(500).json({ error: "Failed to delete conversation." });
    }
  });

  // ─── DELETE /api/messages/:id ───
  // Delete a single message by its MongoDB _id
  router.delete("/:id", async (req, res) => {
    try {
      const result = await Message.findOneAndDelete({
        _id: req.params.id,
        userId: req.userId,
      });

      if (!result) {
        return res.status(404).json({ error: "Message not found." });
      }

      console.log(`🗑️ Deleted message ${req.params.id} for user ${req.userId}`);
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting message:", err.message);
      res.status(500).json({ error: "Failed to delete message." });
    }
  });

  // ─── GET /api/messages/:id/attachment/:attachmentId ───
  // Download an email attachment via Gmail API
  router.get("/:id/attachment/:attachmentId", async (req, res) => {
    try {
      const message = await Message.findOne({
        _id: req.params.id,
        userId: req.userId,
      }).lean();

      if (!message) {
        return res.status(404).json({ error: "Message not found." });
      }

      // Find the attachment metadata
      const attachment = (message.attachments || []).find(
        (a) => a.attachmentId === req.params.attachmentId
      );

      if (!attachment) {
        return res.status(404).json({ error: "Attachment not found." });
      }

      // Fetch from Gmail API
      const connection = await Connection.findOne({
        userId: req.userId,
        channel: "gmail",
        status: "connected",
      });

      if (!connection) {
        return res.status(400).json({ error: "Gmail not connected." });
      }

      const { gmail } = createGmailClient(connection);
      const attachmentData = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId: message.externalId,
        id: req.params.attachmentId,
      });

      // Gmail returns base64url-encoded data
      const buffer = Buffer.from(attachmentData.data.data, "base64");

      res.setHeader("Content-Type", attachment.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `inline; filename="${attachment.filename}"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (err) {
      console.error("Error downloading attachment:", err.message);
      res.status(500).json({ error: "Failed to download attachment." });
    }
  });

  return router;
}
