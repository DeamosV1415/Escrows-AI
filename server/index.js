import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import sgMail from "@sendgrid/mail";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import clientSchema from "./models/Client.js";
import inventoryItemSchema from "./models/InventoryItem.js";
import userSchema from "./models/User.js";
import connectionSchema from "./models/Connection.js";
import messageSchema from "./models/Message.js";
import trackedContactSchema from "./models/TrackedContact.js";
import createClientsRouter from "./routes/clients.js";
import createInventoryRouter from "./routes/inventory.js";
import createAuthRouter from "./routes/auth.js";
import createIntegrationsRouter from "./routes/integrations.js";
import createWebhooksRouter from "./routes/webhooks.js";
import createMessagesRouter from "./routes/messages.js";
import createContactsRouter from "./routes/contacts.js";
import createDashboardRouter from "./routes/dashboard.js";
import authMiddleware from "./middleware/auth.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ─── Waitlist Schema & Model ───
const waitlistSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    company: { type: String, trim: true, default: "" },
    source: { type: String, default: "website" },
  },
  { timestamps: true },
);

// Prevent duplicate emails
waitlistSchema.index({ email: 1 }, { unique: true });

const WaitlistEntry = mongoose.model("WaitlistEntry", waitlistSchema);

// ─── Configure SendGrid ───
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@escrowsai.com";
const TO_EMAIL =
  process.env.TO_EMAIL || process.env.FROM_EMAIL || "noreply@escrowsai.com";

const __filename_early = fileURLToPath(import.meta.url);
const __dirname_early = path.dirname(__filename_early);

// Logo URL — served from /public (no Vite hash, stable URL)
const LOGO_URL = "https://www.escrowsai.com/Logo.png";

// ─── POST /api/waitlist ───
app.post("/api/waitlist", async (req, res) => {
  const { name, email, company } = req.body;

  if (!email || !name) {
    return res.status(400).json({ error: "Name and email are required." });
  }

  try {
    // 1. Save to MongoDB
    const entry = new WaitlistEntry({ name, email, company });
    await entry.save();
    console.log(`📝 Saved to DB: ${name} <${email}>`);

    // 2. Send confirmation email to the user
    const userMsg = {
      to: email,
      from: { email: FROM_EMAIL, name: "Escrows AI" },
      subject: "Welcome to the Escrows AI Waitlist! 🎉",
      html: `
        <div style="font-family: 'Georgia', serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #1A1A1A;">
          <div style="text-align: center; margin-bottom: 32px;">
            <img src="${LOGO_URL}" alt="Escrows AI" style="width: 150px; height: 80px; border-radius: 16px; margin-bottom: 12px;" />
            <h1 style="font-size: 28px; font-weight: 500; color: #2D3A14; margin: 0;">Escrows AI</h1>
          </div>
          <h2 style="font-size: 22px; font-weight: 400; color: #1A1A1A; margin-bottom: 16px;">
            Welcome aboard, ${name}!
          </h2>
          <p style="font-size: 15px; line-height: 1.7; color: #4A4A4A;">
            Thank you for joining the Escrows AI waitlist. You're now among an exclusive group of forward-thinking professionals who will be the first to experience intelligent client management.
          </p>
          <p style="font-size: 15px; line-height: 1.7; color: #4A4A4A;">
            Here's what to expect:
          </p>
          <ul style="font-size: 15px; line-height: 1.8; color: #4A4A4A; padding-left: 20px;">
            <li><strong>Early access</strong> before the public launch</li>
            <li><strong>Exclusive perks</strong> for founding members</li>
            <li><strong>Priority onboarding</strong> and personal setup assistance</li>
          </ul>
          <p style="font-size: 15px; line-height: 1.7; color: #4A4A4A;">
            We'll be in touch soon with updates. In the meantime, keep an eye on your inbox.
          </p>
          <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #E8EDDA;">
            <p style="font-size: 13px; color: #7A7A7A; margin: 0;">
              — The Escrows AI Team
            </p>
          </div>
        </div>
      `,
    };

    // 3. Send notification to admin
    const adminMsg = {
      to: TO_EMAIL,
      from: { email: FROM_EMAIL, name: "Escrows AI Waitlist" },
      subject: `New Waitlist Signup: ${name}`,
      html: `
        <div style="font-family: sans-serif; padding: 24px; color: #1A1A1A;">
          <div style="margin-bottom: 20px;">
            <img src="${LOGO_URL}" alt="Escrows AI" style="width: 90px; height: 64px; border-radius: 12px;" />
          </div>
          <h2 style="margin-top: 0;">New Waitlist Signup</h2>
          <table style="border-collapse: collapse; width: 100%;">
            <tr><td style="padding: 8px 0; font-weight: bold; width: 100px;">Name:</td><td>${name}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: bold;">Email:</td><td>${email}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: bold;">Company:</td><td>${company || "—"}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: bold;">Time:</td><td>${new Date().toISOString()}</td></tr>
          </table>
        </div>
      `,
    };

    await Promise.all([sgMail.send(userMsg), sgMail.send(adminMsg)]);

    console.log(`✅ Waitlist signup complete: ${name} <${email}>`);
    res.json({ success: true, message: "Successfully joined the waitlist!" });
  } catch (error) {
    // Handle duplicate email
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ error: "This email is already on the waitlist!" });
    }

    console.error(
      "Server error:",
      error?.response?.body || error.message || error,
    );
    res.status(500).json({
      error: "Failed to process your request. Please try again.",
    });
  }
});

// ─── Start server only after MongoDB connects ───
const distPath = path.join(__dirname_early, "..", "dist");
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;

async function start() {
  if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI environment variable is not set!");
    process.exit(1);
  }

  if (!process.env.JWT_SECRET) {
    console.error("❌ JWT_SECRET environment variable is not set!");
    process.exit(1);
  }

  // Log redacted URI for debugging
  const redacted = MONGODB_URI.replace(/:([^@]+)@/, ":****@");
  console.log(`🔗 Connecting to MongoDB: ${redacted}`);

  try {
    await mongoose.connect(MONGODB_URI, {
      dbName: "waitlist_clients",
      serverSelectionTimeoutMS: 15000,
    });
    console.log("✅ Connected to MongoDB — waitlist_clients");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  }

  // ─── Second connection for Clients DB (Users, Clients, Inventory) ───
  try {
    const clientsConn = mongoose.createConnection(MONGODB_URI, {
      dbName: "Clients",
      serverSelectionTimeoutMS: 15000,
    });
    await clientsConn.asPromise();
    console.log("✅ Connected to MongoDB — Clients");

    const User = clientsConn.model("User", userSchema, "Users");
    const Client = clientsConn.model("Client", clientSchema, "client's data");
    const InventoryItem = clientsConn.model(
      "InventoryItem",
      inventoryItemSchema,
      "Inventory",
    );
    const Connection = clientsConn.model("Connection", connectionSchema, "Connections");
    const Message = clientsConn.model("Message", messageSchema, "Messages");
    const TrackedContact = clientsConn.model("TrackedContact", trackedContactSchema, "TrackedContacts");

    app.use("/api/auth", createAuthRouter(User));
    app.use("/api/clients", authMiddleware, createClientsRouter(Client, InventoryItem, TrackedContact));
    app.use("/api/inventory", authMiddleware, createInventoryRouter(InventoryItem));
    // Gmail OAuth callback needs to skip auth — Google redirects the browser there (no JWT)
    const integrationsAuthMiddleware = (req, res, next) => {
      if (req.path === "/gmail/callback") return next();
      return authMiddleware(req, res, next);
    };
    app.use("/api/integrations", integrationsAuthMiddleware, createIntegrationsRouter(Connection));
    app.use("/api/webhooks", createWebhooksRouter(Connection, Message, TrackedContact, Client)); // No auth — called by Google
    app.use("/api/messages", authMiddleware, createMessagesRouter(Connection, Message));
    app.use("/api/contacts", authMiddleware, createContactsRouter(TrackedContact, Client));
    app.use("/api/dashboard", authMiddleware, createDashboardRouter(Client, TrackedContact, User));
  } catch (err) {
    console.error("❌ Clients DB connection failed:", err.message);
    process.exit(1);
  }

  // ─── Serve Frontend (production) — AFTER all API routes ───
  app.use(express.static(distPath));
  app.get("/{*splat}", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

start();
