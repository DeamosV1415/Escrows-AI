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
import creditAccountSchema from "./models/CreditAccount.js";
import agentConversationSchema from "./models/AgentConversation.js";
import createClientsRouter from "./routes/clients.js";
import createInventoryRouter from "./routes/inventory.js";
import createAuthRouter from "./routes/auth.js";
import createIntegrationsRouter from "./routes/integrations.js";
import createWebhooksRouter from "./routes/webhooks.js";
import createMessagesRouter from "./routes/messages.js";
import createContactsRouter from "./routes/contacts.js";
import createDashboardRouter from "./routes/dashboard.js";
import createSearchRouter from "./routes/search.js";
import createAgentRouter from "./routes/agent.js";
import createAdminRouter from "./routes/admin.js";
import createBillingRouter from "./routes/billing.js";
import { handleWebhook, isBillingConfigured } from "./billing/billingService.js";
import { BillingError } from "./billing/errors.js";
import { buildAgentGraph } from "./agent/graph.js";
import { buildSequenceAgentGraph } from "./sequences/agent/graph.js";
import authMiddleware from "./middleware/auth.js";
import createAdminAuth from "./middleware/adminAuth.js";
import sequenceSchema from "./models/Sequence.js";
import sequenceEnrollmentSchema from "./models/SequenceEnrollment.js";
import sequenceEventSchema from "./models/SequenceEvent.js";
import sequenceSettingsSchema from "./models/SequenceSettings.js";
import notificationSchema from "./models/Notification.js";
import documentRequestSchema from "./models/DocumentRequest.js";
import activitySchema from "./models/Activity.js";
import adminAuditSchema from "./models/AdminAudit.js";
import { initActivityLog } from "./utils/activityLog.js";
import { initAdminAudit } from "./utils/adminAudit.js";
import createSequencesRouter from "./routes/sequences.js";
import { startScheduler } from "./sequences/scheduler.js";
import { tick as sequenceTick } from "./sequences/engine.js";
import { startGmailAutoSync } from "./utils/gmailSync.js";
import { addClient, removeClient } from "./utils/realtime.js";
import jwt from "jsonwebtoken";

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

// Admin panel sees very low legitimate traffic — a tight limit throttles
// probing/brute-force against the admin surface without affecting normal users.
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // generous for a single admin, restrictive for an attacker
  message: { error: "Too many admin requests. Please slow down." },
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

// The billing webhook needs the RAW body for signature verification — exempt that
// one path from JSON parsing; the route below re-parses it with express.raw().
app.use((req, res, next) => {
  if (req.originalUrl === "/api/webhooks/billing") return next();
  // Capture the raw bytes alongside the parsed JSON so webhook routes that need
  // HMAC signature verification (e.g. WhatsApp/Meta X-Hub-Signature-256) can
  // recompute the digest over the exact payload.
  return express.json({
    limit: "1mb",
    verify: (r, _res, buf) => { r.rawBody = buf; },
  })(req, res, next);
});

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
    const CreditAccount = clientsConn.model("CreditAccount", creditAccountSchema, "CreditAccounts");
    const AgentConversation = clientsConn.model("AgentConversation", agentConversationSchema, "AgentConversations");

    // ─── Sequences models (built early so triggers can fire from client routes/tools) ───
    const Sequence = clientsConn.model("Sequence", sequenceSchema, "Sequences");
    const SequenceEnrollment = clientsConn.model("SequenceEnrollment", sequenceEnrollmentSchema, "SequenceEnrollments");
    const SequenceEvent = clientsConn.model("SequenceEvent", sequenceEventSchema, "SequenceEvents");
    const SequenceSettings = clientsConn.model("SequenceSettings", sequenceSettingsSchema, "SequenceSettings");
    const Notification = clientsConn.model("Notification", notificationSchema, "Notifications");
    const DocumentRequest = clientsConn.model("DocumentRequest", documentRequestSchema, "DocumentRequests");

    // ─── Activity log (dashboard "Recent Activity" feed) ───
    const Activity = clientsConn.model("Activity", activitySchema, "Activities");
    initActivityLog(Activity);

    // ─── Admin audit trail (security record, separate from the user feed) ───
    const AdminAudit = clientsConn.model("AdminAudit", adminAuditSchema, "AdminAudits");
    initAdminAudit(AdminAudit);
    // The `models` bag the engine + triggers consume.
    const sequenceModels = {
      Sequence, SequenceEnrollment, SequenceEvent, SequenceSettings, Notification, DocumentRequest,
      Client, Message, Connection, User, InventoryItem,
    };

    // Shared GridFS bucket (legacy file blobs) — used by inventory routes,
    // client cascade-delete, and agent tools to purge files alongside R2.
    const inventoryBucket = new mongoose.mongo.GridFSBucket(clientsConn.db, { bucketName: "Inventory" });

    app.use("/api/auth", createAuthRouter(User));
    app.use("/api/clients", authMiddleware, createClientsRouter(Client, InventoryItem, TrackedContact, inventoryBucket, sequenceModels));
    app.use("/api/inventory", authMiddleware, createInventoryRouter(InventoryItem, clientsConn, User));
    // Gmail OAuth callback needs to skip auth — Google redirects the browser there (no JWT)
    const integrationsAuthMiddleware = (req, res, next) => {
      if (req.path === "/gmail/callback") return next();
      return authMiddleware(req, res, next);
    };
    app.use("/api/integrations", integrationsAuthMiddleware, createIntegrationsRouter(Connection));
    app.use("/api/webhooks", createWebhooksRouter(Connection, Message, TrackedContact, Client, sequenceModels)); // No auth — called by Google

    // ─── Real-time inbox stream (SSE) ───
    // Registered BEFORE the authed /api/messages mount so it stays exempt from the
    // header-based authMiddleware: EventSource can't set an Authorization header,
    // so it authenticates with a short-lived JWT in the query string instead.
    app.get("/api/messages/stream", (req, res) => {
      let userId;
      try {
        userId = jwt.verify(req.query.token, process.env.JWT_SECRET).userId;
      } catch {
        return res.status(401).end();
      }

      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // disable proxy buffering (nginx)
      });
      res.flushHeaders?.();
      res.write("retry: 5000\n\n"); // tell the browser to reconnect after 5s if dropped

      addClient(userId, res);

      // Heartbeat so proxies/load balancers don't close an idle connection.
      const ping = setInterval(() => {
        try { res.write(": ping\n\n"); } catch { /* ignore */ }
      }, 25000);

      req.on("close", () => {
        clearInterval(ping);
        removeClient(userId, res);
      });
    });

    app.use("/api/messages", authMiddleware, createMessagesRouter(Connection, Message, TrackedContact, Client, sequenceModels));
    app.use("/api/contacts", authMiddleware, createContactsRouter(TrackedContact, Client));
    app.use("/api/dashboard", authMiddleware, createDashboardRouter(Client, TrackedContact, User, Sequence, Message, SequenceEvent, Activity));

    // ─── Universal Search (header command palette) ───
    app.use("/api/search", authMiddleware, createSearchRouter({ Client, InventoryItem, Message, TrackedContact, Sequence }));

    // ─── Admin Panel ───
    // adminLimiter runs before auth so brute-force probing is throttled even on
    // rejected (401/403) requests.
    const adminAuth = createAdminAuth(User);
    app.use("/api/admin", adminLimiter, adminAuth, createAdminRouter(User, CreditAccount, AdminAudit));

    // ─── AI Copilot Agent ───
    // Sequence models are included so the copilot's create/update-client tools can fire triggers.
    const allModels = {
      Client, InventoryItem, User, Connection, Message, TrackedContact, CreditAccount, AgentConversation,
      ...sequenceModels,
    };
    const agentGraph = buildAgentGraph(allModels);
    // The constrained Sequences sub-agent — same chat engine, its own tools + prompt.
    // Selected per request via `mode: "sequences"` on /api/agent/chat.
    const sequenceAgent = buildSequenceAgentGraph(allModels);
    app.use("/api/agent", authMiddleware, createAgentRouter(
      { copilot: agentGraph, sequences: sequenceAgent },
      allModels,
      inventoryBucket,
    ));

    // ─── Billing (provider-agnostic: Stripe / Dodo / …) ───
    // Webhook FIRST: no JWT (the provider calls it), raw body for signature
    // verification. Path is already exempt from the JSON parser (above) and the rate
    // limiter (/webhooks prefix). The active provider verifies + normalizes the event;
    // handleWebhook reconciles it → applyPlanChange.
    app.post("/api/webhooks/billing", express.raw({ type: "*/*" }), async (req, res) => {
      if (!isBillingConfigured()) return res.status(503).end();

      try {
        // Verify signature first (throws BillingError 400 on a bad signature) before acking.
        await handleWebhook(allModels, req.body, req.headers);
        res.json({ received: true });
      } catch (err) {
        const status = err instanceof BillingError ? err.status : 500;
        if (status >= 500) console.error("⚠️ Billing webhook handler error:", err.message);
        res.status(status).send(err.message);
      }
    });

    app.use("/api/billing", authMiddleware, createBillingRouter(allModels));

    // ─── Sequences Engine (durable engine + REST API + scheduler + secret-gated /tick) ───
    // External backup clock (cronjob.org). Secret-gated; no JWT, like webhooks. Registered
    // BEFORE the authed router so this exact path stays exempt from JWT auth.
    app.post("/api/sequences/tick", async (req, res) => {
      const secret = req.get("x-sequence-secret");
      if (!process.env.SEQUENCES_TICK_SECRET || secret !== process.env.SEQUENCES_TICK_SECRET) {
        return res.status(403).json({ error: "Forbidden" });
      }
      try {
        res.json(await sequenceTick({ models: sequenceModels }));
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    app.use("/api/sequences", authMiddleware, createSequencesRouter(sequenceModels));

    // Primary in-process clock.
    startScheduler(sequenceModels);

    // Periodic Gmail auto-sync — pulls new mail for every connected account every
    // few minutes so the inbox stays current without a manual sync. The manual
    // "Sync" button (POST /api/messages/sync) still works alongside this.
    startGmailAutoSync({ Connection, Message, TrackedContact, Client, sequenceModels });
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
