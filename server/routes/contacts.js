import express from "express";

// Escape special regex characters to prevent ReDoS
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default function createContactsRouter(TrackedContact, Client) {
  const router = express.Router();

  // ─── GET /api/contacts ───
  // List all tracked contacts for the logged-in user
  router.get("/", async (req, res) => {
    try {
      const { search, source } = req.query;
      const filter = { userId: req.userId };

      if (source && source !== "all") {
        filter.source = source;
      }

      if (search && search.trim()) {
        const s = escapeRegex(search.trim());
        filter.$or = [
          { name: { $regex: s, $options: "i" } },
          { email: { $regex: s, $options: "i" } },
          { phone: { $regex: s, $options: "i" } },
        ];
      }

      const contacts = await TrackedContact.find(filter)
        .sort({ name: 1 })
        .lean();

      res.json(contacts);
    } catch (err) {
      console.error("Error fetching contacts:", err.message);
      res.status(500).json({ error: "Failed to fetch contacts." });
    }
  });

  // ─── POST /api/contacts/sync-clients ───
  // Auto-create TrackedContacts from existing Clients for the logged-in user
  router.post("/sync-clients", async (req, res) => {
    try {
      const clients = await Client.find({ userId: req.userId }).lean();
      let created = 0;
      let skipped = 0;

      for (const client of clients) {
        try {
          // Check if already tracked
          const existing = await TrackedContact.findOne({
            userId: req.userId,
            email: client.email.toLowerCase(),
          });

          if (existing) {
            skipped++;
            continue;
          }

          const tracked = new TrackedContact({
            userId: req.userId,
            name: client.name,
            email: client.email.toLowerCase(),
            phone: client.phone || "",
            source: "client",
            clientRef: client._id,
            channels: {
              gmail: !!client.email,
              whatsapp: !!client.phone,
              sms: !!client.phone,
            },
          });

          await tracked.save();
          created++;
        } catch (dupErr) {
          // Duplicate key error — skip
          if (dupErr.code === 11000) {
            skipped++;
          } else {
            throw dupErr;
          }
        }
      }

      console.log(
        `🔄 Synced contacts for user ${req.userId}: ${created} created, ${skipped} skipped`
      );
      res.json({
        success: true,
        message: `Synced ${created} new contacts, ${skipped} already tracked.`,
        created,
        skipped,
      });
    } catch (err) {
      console.error("Error syncing contacts:", err.message);
      res.status(500).json({ error: "Failed to sync contacts." });
    }
  });

  // ─── POST /api/contacts ───
  // Create a tracked contact manually
  router.post("/", async (req, res) => {
    try {
      const { name, email, phone, channels } = req.body;

      if (!name || !email) {
        return res.status(400).json({ error: "Name and email are required." });
      }

      // Check for duplicate
      const existing = await TrackedContact.findOne({
        userId: req.userId,
        email: email.toLowerCase(),
      });

      if (existing) {
        return res.status(409).json({ error: "A contact with this email already exists." });
      }

      const contact = new TrackedContact({
        userId: req.userId,
        name,
        email: email.toLowerCase(),
        phone: phone || "",
        source: "imported",
        channels: channels || {
          gmail: !!email,
          whatsapp: !!phone,
          sms: !!phone,
        },
      });

      await contact.save();
      console.log(`➕ Contact created: ${name} <${email}> by user ${req.userId}`);
      res.status(201).json(contact);
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: "A contact with this email already exists." });
      }
      console.error("Error creating contact:", err.message);
      res.status(500).json({ error: "Failed to create contact." });
    }
  });

  // ─── PUT /api/contacts/:id ───
  // Edit a tracked contact
  router.put("/:id", async (req, res) => {
    try {
      const { name, email, phone, channels } = req.body;

      const contact = await TrackedContact.findOne({
        _id: req.params.id,
        userId: req.userId,
      });

      if (!contact) {
        return res.status(404).json({ error: "Contact not found." });
      }

      // If email is changing, check for duplicates
      if (email && email.toLowerCase() !== contact.email) {
        const dup = await TrackedContact.findOne({
          userId: req.userId,
          email: email.toLowerCase(),
          _id: { $ne: contact._id },
        });
        if (dup) {
          return res.status(409).json({ error: "Another contact with this email already exists." });
        }
      }

      if (name !== undefined) contact.name = name;
      if (email !== undefined) contact.email = email.toLowerCase();
      if (phone !== undefined) contact.phone = phone;
      if (channels !== undefined) contact.channels = channels;

      await contact.save();
      console.log(`✏️ Contact updated: ${contact.name} by user ${req.userId}`);
      res.json(contact);
    } catch (err) {
      console.error("Error updating contact:", err.message);
      res.status(500).json({ error: "Failed to update contact." });
    }
  });

  // ─── DELETE /api/contacts/:id ───
  // Delete a tracked contact
  router.delete("/:id", async (req, res) => {
    try {
      const result = await TrackedContact.findOneAndDelete({
        _id: req.params.id,
        userId: req.userId,
      });

      if (!result) {
        return res.status(404).json({ error: "Contact not found." });
      }

      console.log(`🗑️ Contact deleted: ${result.name} by user ${req.userId}`);
      res.json({ success: true, message: "Contact deleted." });
    } catch (err) {
      console.error("Error deleting contact:", err.message);
      res.status(500).json({ error: "Failed to delete contact." });
    }
  });

  return router;
}
