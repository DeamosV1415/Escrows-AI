import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import sgMail from "@sendgrid/mail";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ─── MongoDB Connection ───
const MONGODB_URI = process.env.MONGODB_URI;

mongoose
  .connect(MONGODB_URI, { dbName: "waitlist_clients" })
  .then(() => console.log("✅ Connected to MongoDB — waitlist_clients"))
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));

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

// ─── Serve Frontend (production) ───
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, "..", "dist");

app.use(express.static(distPath));

// SPA fallback — serve index.html for any non-API route
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
