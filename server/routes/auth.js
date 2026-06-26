import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "24h" });
}

// ─── hCaptcha server-side verification ───
async function verifyCaptcha(token) {
  if (!process.env.HCAPTCHA_SECRET_KEY) {
    console.warn("⚠️ HCAPTCHA_SECRET_KEY not set — skipping captcha verification");
    return true; // Skip in dev if not configured
  }

  try {
    const params = new URLSearchParams();
    params.append("response", token);
    params.append("secret", process.env.HCAPTCHA_SECRET_KEY);

    const res = await fetch("https://api.hcaptcha.com/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error("hCaptcha verification error:", err.message);
    return false;
  }
}

export default function createAuthRouter(User) {
  const router = express.Router();

  // ─── POST /api/auth/signup ───
  router.post("/signup", async (req, res) => {
    try {
      const { name, email, password, captcha_token } = req.body;

      // Verify hCaptcha
      if (!captcha_token || !(await verifyCaptcha(captcha_token))) {
        return res.status(400).json({ error: "CAPTCHA verification failed. Please try again." });
      }

      if (!name || !email || !password) {
        return res
          .status(400)
          .json({ error: "Name, email, and password are required." });
      }

      if (password.length < 8) {
        return res
          .status(400)
          .json({ error: "Password must be at least 8 characters." });
      }

      // Strong password policy: uppercase, lowercase, number, special char
      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
      if (!passwordRegex.test(password)) {
        return res.status(400).json({
          error:
            "Password must contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.",
        });
      }

      // Check if user already exists
      const existing = await User.findOne({ email: email.toLowerCase() });
      if (existing) {
        return res
          .status(409)
          .json({ error: "An account with this email already exists." });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = new User({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
      });
      await user.save();
      console.log(`✅ User signed up: ${user.name} <${user.email}>`);

      const token = generateToken(user._id);
      res.status(201).json({
        token,
        user: { id: user._id, name: user.name, email: user.email, profileComplete: user.profileComplete },
      });
    } catch (err) {
      console.error("Signup error:", err.message);
      res.status(500).json({ error: "Signup failed. Please try again." });
    }
  });

  // ─── POST /api/auth/login ───
  router.post("/login", async (req, res) => {
    try {
      const { email, password, captcha_token } = req.body;

      // Verify hCaptcha
      if (!captcha_token || !(await verifyCaptcha(captcha_token))) {
        return res.status(400).json({ error: "CAPTCHA verification failed. Please try again." });
      }

      if (!email || !password) {
        return res
          .status(400)
          .json({ error: "Email and password are required." });
      }

      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password." });
      }

      if (!user.password) {
        return res.status(401).json({
          error:
            "This account uses Google Sign-In. Please sign in with Google.",
        });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ error: "Invalid email or password." });
      }

      console.log(`✅ User logged in: ${user.name} <${user.email}>`);

      const token = generateToken(user._id);
      res.json({
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          profileComplete: user.profileComplete,
        },
      });
    } catch (err) {
      console.error("Login error:", err.message);
      res.status(500).json({ error: "Login failed. Please try again." });
    }
  });

  // ─── POST /api/auth/google ───
  router.post("/google", async (req, res) => {
    try {
      const { credential } = req.body;

      if (!credential) {
        return res.status(400).json({ error: "Google credential is required." });
      }

      // Verify the Google ID token
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      const { sub: googleId, email, name, picture } = payload;

      // Find existing user by googleId or email
      let user = await User.findOne({
        $or: [{ googleId }, { email: email.toLowerCase() }],
      });

      if (user) {
        // Link Google account if not already linked
        if (!user.googleId) {
          user.googleId = googleId;
          user.avatar = picture || user.avatar;
          await user.save();
        }
      } else {
        // Create new user
        user = new User({
          name,
          email: email.toLowerCase(),
          googleId,
          avatar: picture,
        });
        await user.save();
        console.log(`✅ Google user created: ${name} <${email}>`);
      }

      console.log(`✅ Google sign-in: ${user.name} <${user.email}>`);

      const token = generateToken(user._id);
      res.json({
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          profileComplete: user.profileComplete,
        },
      });
    } catch (err) {
      console.error("Google auth error:", err.message);
      res.status(401).json({ error: "Google authentication failed." });
    }
  });

  // ─── GET /api/auth/me ───
  router.get("/me", async (req, res) => {
    try {
      const header = req.headers.authorization;
      if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided." });
      }

      const token = header.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select("-password");

      if (!user) {
        return res.status(404).json({ error: "User not found." });
      }

      res.json({
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          profileComplete: user.profileComplete,
          phone: user.phone,
          company: user.company,
          jobTitle: user.jobTitle,
          licenseNumber: user.licenseNumber,
          yearsInBusiness: user.yearsInBusiness,
          location: user.location,
          specialization: user.specialization,
          teamSize: user.teamSize,
          getStartedDismissed: user.getStartedDismissed,
        },
      });
    } catch (err) {
      return res.status(401).json({ error: "Invalid token." });
    }
  });

  // ─── POST /api/auth/onboarding/dismiss ───
  // Permanently hides the dashboard "Get started" checklist for this user.
  router.post("/onboarding/dismiss", async (req, res) => {
    try {
      const header = req.headers.authorization;
      if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided." });
      }
      const decoded = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
      await User.findByIdAndUpdate(decoded.userId, { $set: { getStartedDismissed: true } });
      res.json({ success: true });
    } catch (err) {
      res.status(401).json({ error: "Invalid token." });
    }
  });

  // ─── PUT /api/auth/profile ───
  router.put("/profile", async (req, res) => {
    try {
      const header = req.headers.authorization;
      if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided." });
      }

      const token = header.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const { name, phone, company, jobTitle, licenseNumber, yearsInBusiness, location, specialization, teamSize } = req.body;

      const $set = {
        phone: phone || "",
        company: company || "",
        jobTitle: jobTitle || "",
        licenseNumber: licenseNumber || "",
        yearsInBusiness: yearsInBusiness || null,
        location: location || "",
        specialization: specialization || "",
        teamSize: teamSize || "",
        profileComplete: true,
      };
      // Name is editable from Settings; only overwrite when a non-empty value is sent so
      // the onboarding flow (which omits it) never blanks an existing name.
      if (typeof name === "string" && name.trim()) $set.name = name.trim();

      const user = await User.findByIdAndUpdate(
        decoded.userId,
        { $set },
        { returnDocument: "after" },
      ).select("-password");

      if (!user) {
        return res.status(404).json({ error: "User not found." });
      }

      console.log(`✅ Profile updated: ${user.name} <${user.email}>`);
      res.json({
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          profileComplete: user.profileComplete,
          phone: user.phone,
          company: user.company,
          jobTitle: user.jobTitle,
          licenseNumber: user.licenseNumber,
          yearsInBusiness: user.yearsInBusiness,
          location: user.location,
          specialization: user.specialization,
          teamSize: user.teamSize,
        },
      });
    } catch (err) {
      console.error("Profile update error:", err.message);
      res.status(500).json({ error: "Failed to update profile." });
    }
  });

  return router;
}
