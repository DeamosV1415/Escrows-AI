import { z } from "zod";
import { google } from "googleapis";
import { decrypt } from "../../utils/encryption.js";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
];

export default function registerIntegrationTools(registry, { Connection }) {

  registry.register({
    category: "integrations",
    name: "get_integration_status",
    description: "Check whether Gmail and WhatsApp are connected, and which email / phone is linked.",
    creditCost: 1,
    sensitive: false,
    schema: z.object({}),
    handler: async (_a, userId) => {
      const conns = await Connection.find({ userId }).lean();
      const status = {
        gmail:    { connected: false, email: null },
        whatsapp: { connected: false, phone: null },
      };
      for (const c of conns) {
        if (c.channel === "gmail" && c.status === "connected") {
          status.gmail = { connected: true, email: c.gmailEmail };
        }
        if (c.channel === "whatsapp" && c.status === "connected") {
          status.whatsapp = { connected: true, phone: c.waDisplayPhone };
        }
      }
      return status;
    },
  });

  registry.register({
    category: "integrations",
    name: "get_gmail_auth_url",
    description: "Generate the Google OAuth consent URL so the user can connect Gmail. Return the URL in your reply text — the user must click it; you cannot complete the OAuth flow for them.",
    creditCost: 1,
    sensitive: false,
    schema: z.object({}),
    handler: async (_a, userId) => {
      const client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI,
      );
      const url = client.generateAuthUrl({
        access_type: "offline",
        scope: GMAIL_SCOPES,
        prompt: "consent",
        state: userId,
      });
      return { url };
    },
  });

  registry.register({
    category: "integrations",
    name: "disconnect_gmail",
    description: "Disconnect Gmail: stop push notifications, revoke the OAuth token with Google, and remove the connection record.",
    creditCost: 2,
    sensitive: true,
    buildDescription: () =>
      "Disconnect Gmail? This revokes the OAuth token with Google and stops syncing new messages.",
    schema: z.object({}),
    handler: async (_a, userId) => {
      const conn = await Connection.findOne({ userId, channel: "gmail" });
      if (!conn || conn.status !== "connected") throw new Error("Gmail is not connected.");
      try {
        const tokens = JSON.parse(decrypt(conn.gmailTokens));
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI,
        );
        oauth2Client.setCredentials(tokens);
        const gmail = google.gmail({ version: "v1", auth: oauth2Client });
        await gmail.users.stop({ userId: "me" }).catch(() => {});
        await oauth2Client.revokeToken(tokens.access_token).catch(() => {});
      } catch (e) {
        console.warn("disconnect_gmail: token revocation issue:", e.message);
      }
      await Connection.deleteOne({ _id: conn._id });
      return { success: true, disconnected: "gmail" };
    },
  });

  registry.register({
    category: "integrations",
    name: "disconnect_whatsapp",
    description: "Disconnect WhatsApp by removing the stored credentials and connection record.",
    creditCost: 2,
    sensitive: true,
    buildDescription: () => "Disconnect WhatsApp? Outbound sends will stop working until it's reconnected.",
    schema: z.object({}),
    handler: async (_a, userId) => {
      const conn = await Connection.findOne({ userId, channel: "whatsapp" });
      if (!conn || conn.status !== "connected") throw new Error("WhatsApp is not connected.");
      await Connection.deleteOne({ _id: conn._id });
      return { success: true, disconnected: "whatsapp" };
    },
  });
}
