import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

export default function createAuthRouter(User) {
  const router = express.Router();

  // ─── POST /api/auth/signup ───
  router.post("/signup", async (req, res) => {
    try {
      const { name, email, password } = req.body;

      if (!name || !email || !password) {
        return res
          .status(400)
          .json({ error: "Name, email, and password are required." });
      }

      if (password.length < 6) {
        return res
          .status(400)
          .json({ error: "Password must be at least 6 characters." });
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
      const { email, password } = req.body;

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
        },
      });
    } catch (err) {
      return res.status(401).json({ error: "Invalid token." });
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

      const { phone, company, jobTitle, licenseNumber, yearsInBusiness, location, specialization, teamSize } = req.body;

      const user = await User.findByIdAndUpdate(
        decoded.userId,
        {
          $set: {
            phone: phone || "",
            company: company || "",
            jobTitle: jobTitle || "",
            licenseNumber: licenseNumber || "",
            yearsInBusiness: yearsInBusiness || null,
            location: location || "",
            specialization: specialization || "",
            teamSize: teamSize || "",
            profileComplete: true,
          },
        },
        { new: true },
      ).select("-password");

      if (!user) {
        return res.status(404).json({ error: "User not found." });
      }

      console.log(`✅ Profile completed: ${user.name} <${user.email}>`);
      res.json({
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          profileComplete: user.profileComplete,
        },
      });
    } catch (err) {
      console.error("Profile update error:", err.message);
      res.status(500).json({ error: "Failed to update profile." });
    }
  });

  return router;
}
