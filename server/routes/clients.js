import express from "express";
import { purgeInventoryBlob } from "../utils/r2.js";

// Escape special regex characters to prevent ReDoS
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default function createClientsRouter(Client, InventoryItem, TrackedContact, inventoryBucket) {
  const router = express.Router();

  // ─── GET /api/clients ───
  // Query params: search, stage, intent, sort
  router.get("/", async (req, res) => {
    try {
      const { search, stage, intent, sort } = req.query;
      const filter = { userId: req.userId };

      // Search by name, email, or company
      if (search && search.trim()) {
        const s = escapeRegex(search.trim());
        filter.$or = [
          { name: { $regex: s, $options: "i" } },
          { email: { $regex: s, $options: "i" } },
          { company: { $regex: s, $options: "i" } },
        ];
      }

      // Filter by stage
      if (stage && stage !== "all") {
        filter.stage = stage;
      }

      // Filter by intent
      if (intent && intent !== "all") {
        filter.intent = intent;
      }

      // Sort options
      let sortOption = { updatedAt: -1 }; // default: last activity
      if (sort === "name") sortOption = { name: 1 };
      else if (sort === "budget") sortOption = { budget: -1 };
      else if (sort === "created") sortOption = { createdAt: -1 };

      const clients = await Client.find(filter).sort(sortOption).lean();
      res.json(clients);
    } catch (err) {
      console.error("Error fetching clients:", err.message);
      res.status(500).json({ error: "Failed to fetch clients." });
    }
  });

  // ─── POST /api/clients ───
  router.post("/", async (req, res) => {
    try {
      const {
        name,
        email,
        company,
        phone,
        stage,
        intent,
        budget,
        requirements,
        nextAction,
        nextActionPriority,
        notes,
      } = req.body;

      if (!name || !email) {
        return res.status(400).json({ error: "Name and email are required." });
      }

      const client = new Client({
        userId: req.userId,
        name,
        email,
        company,
        phone,
        stage,
        intent,
        budget: budget || 0,
        requirements,
        nextAction,
        nextActionPriority,
        notes,
      });

      await client.save();
      console.log(`✅ Client created: ${name} <${email}>`);

      // ─── Auto-create TrackedContact for inbox ───
      if (TrackedContact && email) {
        try {
          const existing = await TrackedContact.findOne({
            userId: req.userId,
            email: email.toLowerCase(),
          });
          if (!existing) {
            const tracked = new TrackedContact({
              userId: req.userId,
              name,
              email: email.toLowerCase(),
              phone: phone || "",
              source: "client",
              clientRef: client._id,
              channels: {
                gmail: !!email,
                whatsapp: !!phone,
                sms: !!phone,
              },
            });
            await tracked.save();
            console.log(`📇 Auto-created tracked contact: ${name} <${email}>`);
          }
        } catch (tcErr) {
          if (tcErr.code !== 11000) {
            console.error("⚠️ Failed to auto-create tracked contact:", tcErr.message);
          }
        }
      }

      // ─── Auto-create inventory folder for this client ───
      if (InventoryItem) {
        try {
          const folderName = company ? `${name} - ${company}` : name;
          const folder = new InventoryItem({
            userId: req.userId,
            clientId: client._id,
            name: folderName,
            type: "folder",
            parentId: null,
          });
          await folder.save();
          console.log(`📁 Auto-created inventory folder: ${folderName}`);
        } catch (folderErr) {
          console.error(
            "⚠️ Failed to auto-create inventory folder:",
            folderErr.message,
          );
          // Don't fail the client creation — folder is secondary
        }
      }

      res.status(201).json(client.toObject());
    } catch (err) {
      console.error("Error creating client:", err.message);
      res.status(500).json({ error: "Failed to create client." });
    }
  });

  // ─── PUT /api/clients/:id ───
  router.put("/:id", async (req, res) => {
    try {
      const updates = req.body;
      const client = await Client.findOneAndUpdate(
        { _id: req.params.id, userId: req.userId },
        { $set: updates },
        { returnDocument: "after", runValidators: true },
      ).lean();

      if (!client) {
        return res.status(404).json({ error: "Client not found." });
      }

      // ─── Sync inventory folder name if name/company changed ───
      if (InventoryItem && (updates.name || updates.company)) {
        try {
          const folderName = client.company
            ? `${client.name} - ${client.company}`
            : client.name;
          await InventoryItem.findOneAndUpdate(
            { clientId: client._id, parentId: null, type: "folder", userId: req.userId },
            { $set: { name: folderName } },
          );
          console.log(`🔄 Inventory folder synced: ${folderName}`);
        } catch (syncErr) {
          console.error("⚠️ Failed to sync inventory folder:", syncErr.message);
        }
      }

      console.log(`✏️  Client updated: ${client.name}`);
      res.json(client);
    } catch (err) {
      console.error("Error updating client:", err.message);
      res.status(500).json({ error: "Failed to update client." });
    }
  });

  // ─── DELETE /api/clients/:id ───
  router.delete("/:id", async (req, res) => {
    try {
      const client = await Client.findOneAndDelete({ _id: req.params.id, userId: req.userId });

      if (!client) {
        return res.status(404).json({ error: "Client not found." });
      }

      // ─── Cascade delete all inventory items for this client ───
      if (InventoryItem) {
        try {
          const items = await InventoryItem.find({
            clientId: client._id,
            userId: req.userId,
          }).lean();
          // Purge each file's blob (R2 → legacy GridFS → legacy disk)
          for (const item of items) {
            if (item.type === "file") {
              await purgeInventoryBlob(item, inventoryBucket);
            }
          }
          const result = await InventoryItem.deleteMany({
            clientId: client._id,
            userId: req.userId,
          });
          console.log(
            `🗑️  Cascade deleted ${result.deletedCount} inventory items for: ${client.name}`,
          );
        } catch (invErr) {
          console.error(
            "⚠️ Failed to cascade delete inventory:",
            invErr.message,
          );
        }
      }

      // ─── Remove linked TrackedContact ───
      if (TrackedContact) {
        try {
          await TrackedContact.deleteOne({
            userId: req.userId,
            clientRef: client._id,
          });
          console.log(`📇 Removed tracked contact for: ${client.name}`);
        } catch (tcErr) {
          console.error("⚠️ Failed to remove tracked contact:", tcErr.message);
        }
      }

      console.log(`🗑️  Client deleted: ${client.name}`);
      res.json({ success: true, message: "Client deleted." });
    } catch (err) {
      console.error("Error deleting client:", err.message);
      res.status(500).json({ error: "Failed to delete client." });
    }
  });

  return router;
}
