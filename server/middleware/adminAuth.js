import jwt from "jsonwebtoken";

/**
 * Admin authentication middleware.
 * 1. Validates the JWT token (same as authMiddleware).
 * 2. Looks up the user's email and checks it against ADMIN_EMAILS env var.
 *
 * Requires the `User` model to be attached via the factory function.
 */
export default function createAdminAuth(User) {
  return async function adminAuth(req, res, next) {
    // ─── Step 1: Validate JWT ───
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const token = header.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Invalid or expired token." });
    }

    req.userId = decoded.userId;

    // ─── Step 2: Check admin whitelist ───
    const adminEmails = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (adminEmails.length === 0) {
      return res
        .status(403)
        .json({ error: "No admin emails configured on the server." });
    }

    try {
      const user = await User.findById(decoded.userId).select("email").lean();

      if (!user) {
        return res.status(404).json({ error: "User not found." });
      }

      if (!adminEmails.includes(user.email.toLowerCase())) {
        return res
          .status(403)
          .json({ error: "You do not have admin privileges." });
      }

      req.adminEmail = user.email;
      next();
    } catch (err) {
      console.error("Admin auth error:", err.message);
      return res.status(500).json({ error: "Admin verification failed." });
    }
  };
}
