import express from "express";
import { google } from "googleapis";
import { encrypt, decrypt } from "../utils/encryption.js";
import { createGmailClient } from "../utils/gmailClient.js";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
];

export default function createIntegrationsRouter(Connection) {
  const router = express.Router();

  // ─── GET /api/integrations/status ───
  // Returns connection status for all channels for the logged-in user
  router.get("/status", async (req, res) => {
    try {
      const connections = await Connection.find({ userId: req.userId }).lean();
      const status = {
        gmail: { connected: false, email: null },
        whatsapp: { connected: false, phone: null },
      };

      for (const conn of connections) {
        if (conn.channel === "gmail" && conn.status === "connected") {
          status.gmail = { connected: true, email: conn.gmailEmail };
        }
        if (conn.channel === "whatsapp" && conn.status === "connected") {
          status.whatsapp = { connected: true, phone: conn.waDisplayPhone };
        }
      }

      res.json(status);
    } catch (err) {
      console.error("Error fetching integration status:", err.message);
      res.status(500).json({ error: "Failed to fetch integration status." });
    }
  });

  // ─── GET /api/integrations/gmail/auth-url ───
  // Generates the Google OAuth consent URL
  router.get("/gmail/auth-url", async (req, res) => {
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: GMAIL_SCOPES,
        prompt: "consent", // Force consent to always get refresh_token
        state: req.userId, // Pass userId so callback knows who connected
      });

      res.json({ url });
    } catch (err) {
      console.error("Error generating Gmail auth URL:", err.message);
      res.status(500).json({ error: "Failed to generate auth URL." });
    }
  });

  // ─── GET /api/integrations/gmail/callback ───
  // OAuth callback — exchanges code for tokens, stores encrypted, sets up watch
  router.get("/gmail/callback", async (req, res) => {
    try {
      const { code, state: userId } = req.query;

      if (!code || !userId) {
        return res.status(400).send("Missing authorization code or user ID.");
      }

      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      // Exchange code for tokens
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      // Get the user's Gmail email address
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: "me" });
      const gmailEmail = profile.data.emailAddress;

      // Encrypt tokens for storage
      const encryptedTokens = encrypt(JSON.stringify(tokens));

      // Upsert connection (one Gmail connection per user)
      const connection = await Connection.findOneAndUpdate(
        { userId, channel: "gmail" },
        {
          $set: {
            status: "connected",
            gmailEmail,
            gmailTokens: encryptedTokens,
            gmailHistoryId: profile.data.historyId,
          },
        },
        { upsert: true, new: true }
      );

      // Clean up stale connections: if another user was previously connected
      // to the same Gmail, remove their (now-invalid) connection
      const staleCleanup = await Connection.deleteMany({
        gmailEmail,
        channel: "gmail",
        _id: { $ne: connection._id },
      });
      if (staleCleanup.deletedCount > 0) {
        console.log(`🧹 Removed ${staleCleanup.deletedCount} stale Gmail connection(s) for ${gmailEmail}`);
      }

      // Set up Gmail push notifications via Pub/Sub
      try {
        const watchResponse = await gmail.users.watch({
          userId: "me",
          requestBody: {
            topicName: process.env.GOOGLE_PUBSUB_TOPIC,
            labelIds: ["INBOX"],
          },
        });

        connection.gmailWatchExpiry = new Date(
          parseInt(watchResponse.data.expiration)
        );
        await connection.save();
        console.log(
          `👁️ Gmail watch set up for ${gmailEmail}, expires: ${connection.gmailWatchExpiry}`
        );
      } catch (watchErr) {
        console.error(
          "⚠️ Gmail watch setup failed (webhook won't fire until fixed):",
          watchErr.message
        );
        // Don't fail the connection — OAuth succeeded, watch can be retried
      }

      console.log(`✅ Gmail connected for user ${userId}: ${gmailEmail}`);

      // Send a success page that closes the popup
      const safeEmail = gmailEmail.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
      res.send(`
        <!DOCTYPE html>
        <html>
          <head><title>Gmail Connected</title></head>
          <body>
            <h2 style="font-family: sans-serif; text-align: center; margin-top: 40vh;">
              ✅ Gmail connected successfully!
            </h2>
            <p style="font-family: sans-serif; text-align: center; color: #666;">
              This window will close automatically...
            </p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'GMAIL_CONNECTED', email: ${JSON.stringify(gmailEmail)} }, ${JSON.stringify(process.env.VITE_APP_URL || 'https://www.escrowsai.com')});
              }
              setTimeout(() => window.close(), 1500);
            </script>
          </body>
        </html>
      `);
    } catch (err) {
      console.error("Gmail OAuth callback error:", err.message);
      const safeErrMsg = (err.message || 'Unknown error').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
          <head><title>Connection Failed</title></head>
          <body>
            <h2 style="font-family: sans-serif; text-align: center; margin-top: 40vh; color: #dc3545;">
              ❌ Gmail connection failed
            </h2>
            <p style="font-family: sans-serif; text-align: center; color: #666;">
              ${safeErrMsg}<br/>Please close this window and try again.
            </p>
          </body>
        </html>
      `);
    }
  });

  // ─── DELETE /api/integrations/gmail/disconnect ───
  // Revokes Gmail access and removes the connection
  router.delete("/gmail/disconnect", async (req, res) => {
    try {
      const connection = await Connection.findOne({
        userId: req.userId,
        channel: "gmail",
      });

      if (!connection || connection.status !== "connected") {
        return res.status(404).json({ error: "No active Gmail connection found." });
      }

      // Try to revoke the token with Google
      try {
        const tokens = JSON.parse(decrypt(connection.gmailTokens));
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials(tokens);

        // Stop watching for push notifications
        const gmail = google.gmail({ version: "v1", auth: oauth2Client });
        await gmail.users.stop({ userId: "me" });

        // Revoke the token
        await oauth2Client.revokeToken(tokens.access_token);
      } catch (revokeErr) {
        console.error("⚠️ Token revocation error (continuing):", revokeErr.message);
        // Don't fail — we still want to remove the connection from our DB
      }

      // Remove the connection document
      await Connection.deleteOne({ _id: connection._id });

      console.log(`🔌 Gmail disconnected for user ${req.userId}`);
      res.json({ success: true, message: "Gmail disconnected." });
    } catch (err) {
      console.error("Gmail disconnect error:", err.message);
      res.status(500).json({ error: "Failed to disconnect Gmail." });
    }
  });

  // ═══════════════════════════════════════════════
  //  WhatsApp Integration
  // ═══════════════════════════════════════════════

  // ─── POST /api/integrations/whatsapp/connect ───
  // Connects WhatsApp using Phone Number ID + Access Token
  router.post("/whatsapp/connect", async (req, res) => {
    try {
      const { phoneNumberId, accessToken } = req.body;

      if (!phoneNumberId || !accessToken) {
        return res
          .status(400)
          .json({ error: "Phone Number ID and Access Token are required." });
      }

      // Verify the credentials by calling the WhatsApp Cloud API
      const verifyRes = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}?access_token=${accessToken}`
      );

      if (!verifyRes.ok) {
        const errorData = await verifyRes.json().catch(() => ({}));
        const msg = errorData.error?.message || "Invalid credentials";
        return res.status(400).json({ error: `WhatsApp verification failed: ${msg}` });
      }

      const phoneData = await verifyRes.json();
      const displayPhone = phoneData.display_phone_number || phoneNumberId;

      // Encrypt the access token for storage
      const encryptedToken = encrypt(accessToken);

      // Upsert connection (one WhatsApp connection per user)
      await Connection.findOneAndUpdate(
        { userId: req.userId, channel: "whatsapp" },
        {
          $set: {
            status: "connected",
            waPhoneNumberId: phoneNumberId,
            waAccessToken: encryptedToken,
            waDisplayPhone: displayPhone,
          },
        },
        { upsert: true, new: true }
      );

      console.log(`✅ WhatsApp connected for user ${req.userId}: ${displayPhone}`);
      res.json({
        success: true,
        message: "WhatsApp connected successfully.",
        phone: displayPhone,
      });
    } catch (err) {
      console.error("WhatsApp connect error:", err.message);
      res.status(500).json({ error: "Failed to connect WhatsApp." });
    }
  });

  // ─── DELETE /api/integrations/whatsapp/disconnect ───
  router.delete("/whatsapp/disconnect", async (req, res) => {
    try {
      const connection = await Connection.findOne({
        userId: req.userId,
        channel: "whatsapp",
      });

      if (!connection || connection.status !== "connected") {
        return res.status(404).json({ error: "No active WhatsApp connection found." });
      }

      await Connection.deleteOne({ _id: connection._id });

      console.log(`🔌 WhatsApp disconnected for user ${req.userId}`);
      res.json({ success: true, message: "WhatsApp disconnected." });
    } catch (err) {
      console.error("WhatsApp disconnect error:", err.message);
      res.status(500).json({ error: "Failed to disconnect WhatsApp." });
    }
  });

  return router;
}
