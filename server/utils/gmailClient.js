import { google } from "googleapis";
import { decrypt, encrypt } from "./encryption.js";

/**
 * Create an authenticated Gmail API client from a Connection document.
 * Auto-refreshes expired tokens and updates the DB.
 *
 * @param {Object} connection - The Connection mongoose document
 * @returns {{ gmail: object, oauth2Client: object }}
 */
export function createGmailClient(connection) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  // Decrypt and set tokens
  const tokens = JSON.parse(decrypt(connection.gmailTokens));
  oauth2Client.setCredentials(tokens);

  // Auto-save refreshed tokens
  oauth2Client.on("tokens", async (newTokens) => {
    try {
      const merged = { ...tokens, ...newTokens };
      connection.gmailTokens = encrypt(JSON.stringify(merged));
      await connection.save();
      console.log(`🔄 Gmail tokens refreshed for ${connection.gmailEmail}`);
    } catch (err) {
      console.error("Failed to save refreshed tokens:", err.message);
    }
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  return { gmail, oauth2Client };
}
