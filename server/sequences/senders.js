import { createGmailClient } from "../utils/gmailClient.js";
import { decrypt } from "../utils/encryption.js";

/**
 * The ONE send path for the whole platform. Both the AI copilot's message tools
 * (server/agent/tools/message_tools.js) and the sequence engine call these, so there is
 * a single place to get delivery + logging right. Each send also writes an outbound
 * Message row (identical to what the agent did), so reply-detection and history work.
 *
 * These functions THROW if the channel isn't connected — callers decide how to handle it
 * (the engine treats it as a retryable failure).
 */

export async function sendEmail({ Connection, Message }, userId, { to, subject, body, threadId, contactName }) {
  const conn = await Connection.findOne({ userId, channel: "gmail", status: "connected" });
  if (!conn) throw new Error("Gmail is not connected. Open Settings → Integrations to connect it.");

  const { gmail } = createGmailClient(conn);
  const finalSubject = subject || "(no subject)";
  const raw = Buffer.from(
    [
      `To: ${to}`,
      `From: ${conn.gmailEmail}`,
      `Subject: ${finalSubject}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ].join("\r\n"),
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const reqBody = { raw };
  if (threadId) reqBody.threadId = threadId;
  const sent = await gmail.users.messages.send({ userId: "me", requestBody: reqBody });

  const stored = await Message.create({
    userId,
    channel: "gmail",
    contactIdentifier: to,
    contactName: contactName || to,
    externalId: sent.data.id,
    threadId: sent.data.threadId || threadId,
    direction: "outbound",
    body,
    subject: finalSubject,
    status: "delivered",
    timestamp: new Date(),
  });

  return {
    success: true,
    channel: "gmail",
    to,
    subject: finalSubject,
    externalId: sent.data.id,
    threadId: sent.data.threadId || threadId || null,
    messageId: String(stored._id),
  };
}

export async function sendWhatsApp({ Connection, Message }, userId, { to, body, contactName }) {
  const conn = await Connection.findOne({ userId, channel: "whatsapp", status: "connected" });
  if (!conn) throw new Error("WhatsApp is not connected. Open Settings → Integrations to connect it.");

  const token = decrypt(conn.waAccessToken);
  const res = await fetch(`https://graph.facebook.com/v21.0/${conn.waPhoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
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
    contactIdentifier: to,
    contactName: contactName || to,
    externalId: data.messages?.[0]?.id || null,
    threadId: to,
    direction: "outbound",
    body,
    status: "delivered",
    timestamp: new Date(),
  });

  return {
    success: true,
    channel: "whatsapp",
    to,
    externalId: data.messages?.[0]?.id || null,
    messageId: String(stored._id),
  };
}
