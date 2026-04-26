import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
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

// ─── Security Hardening ───
app.set('trust proxy', 1);
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://accounts.google.com",
          "https://apis.google.com",
          "https://hcaptcha.com",
          "https://*.hcaptcha.com",
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://accounts.google.com",
          "https://hcaptcha.com",
          "https://*.hcaptcha.com",
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: [
          "'self'",
          "https://api.emailjs.com",
          "https://accounts.google.com",
          "https://graph.facebook.com",
          "https://hcaptcha.com",
          "https://*.hcaptcha.com",
        ],
        frameSrc: ["'self'", "blob:", "https://accounts.google.com", "https://hcaptcha.com", "https://*.hcaptcha.com"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false, // Required for Google Identity Services
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }, // Required for OAuth popups
  })
);

const allowedOrigins = [
  "https://www.escrowsai.com",
  "https://escrowsai.com",
];
if (process.env.NODE_ENV !== "production") {
  allowedOrigins.push("http://localhost:5173", "http://localhost:3001");
}
app.use(cors({ origin: allowedOrigins, credentials: true }));

// ─── Rate Limiting ───
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // 15 attempts per window
  message: { error: "Too many attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500, // 500 requests per 15 min (dashboard polls frequently)
  message: { error: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api/auth/google", authLimiter);
// General API limiter — skip session restore & webhooks (they have their own auth)
app.use("/api/", (req, res, next) => {
  if (req.path === "/auth/me" || req.path.startsWith("/webhooks")) {
    return next();
  }
  return apiLimiter(req, res, next);
});

app.use(express.json({ limit: "1mb" }));

const __filename_early = fileURLToPath(import.meta.url);
const __dirname_early = path.dirname(__filename_early);

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

  // ─── Clients DB (Users, Clients, Inventory, Messages, etc.) ───
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
    app.use("/api/inventory", authMiddleware, createInventoryRouter(InventoryItem, clientsConn));
    // Gmail OAuth callback needs to skip auth — Google redirects the browser there (no JWT)
    const integrationsAuthMiddleware = (req, res, next) => {
      if (req.path === "/gmail/callback") return next();
      return authMiddleware(req, res, next);
    };
    app.use("/api/integrations", integrationsAuthMiddleware, createIntegrationsRouter(Connection));
    app.use("/api/webhooks", createWebhooksRouter(Connection, Message, TrackedContact, Client)); // No auth — called by Google
    app.use("/api/messages", authMiddleware, createMessagesRouter(Connection, Message, TrackedContact, Client));
    app.use("/api/contacts", authMiddleware, createContactsRouter(TrackedContact, Client));
    app.use("/api/dashboard", authMiddleware, createDashboardRouter(Client, TrackedContact, User));
  } catch (err) {
    console.error("❌ Clients DB connection failed:", err.message);
    process.exit(1);
  }

  // ─── 404 handler for unknown API routes ───
  app.use("/api/{*splat}", (req, res) => {
    res.status(404).json({ error: "Endpoint not found." });
  });

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
