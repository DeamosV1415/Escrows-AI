import express from "express";
import { purgeInventoryBlob } from "../utils/r2.js";
import { enrollOnClientCreated, enrollOnStageChanged } from "../sequences/triggers.js";
import { logActivity } from "../utils/activityLog.js";

// Escape special regex characters to prevent ReDoS
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Human labels for client fields shown in the Recent Activity feed.
const FIELD_LABELS = {
  name: "name",
  email: "email",
  company: "company",
  phone: "phone",
  stage: "stage",
  intent: "intent",
  budget: "budget",
  nextAction: "next action",
  nextActionPriority: "priority",
  requirements: "requirements",
  notes: "notes",
};
// Short fields we render as "before → after"; everything else is reported by name only.
const VALUE_FIELDS = new Set([
  "name", "email", "company", "phone", "stage", "intent", "budget", "nextActionPriority",
]);

const displayVal = (v) => (v === "" || v === null || v === undefined ? "—" : String(v));

/**
 * Diff the prior client doc against the updated one into structured changes the
 * activity feed renders as individual chips. Short fields carry from/to values
 * (rendered "intent (warm → hot)"); long text fields carry just a label.
 * Returns [{ field, label, from, to }] — from/to are null for non-valued fields.
 */
function buildClientChanges(before, after, updates) {
  const changes = [];
  for (const key of Object.keys(updates)) {
    const label = FIELD_LABELS[key];
    if (!label) continue; // skip non-displayable / unknown keys
    const from = before?.[key];
    const to = after?.[key];
    if (String(from ?? "") === String(to ?? "")) continue; // unchanged
    changes.push(
      VALUE_FIELDS.has(key)
        ? { field: key, label, from: displayVal(from), to: displayVal(to) }
        : { field: key, label, from: null, to: null },
    );
  }
  return changes;
}

export default function createClientsRouter(Client, InventoryItem, TrackedContact, inventoryBucket, sequenceModels) {
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
      logActivity({
        userId: req.userId,
        category: "client",
        action: "created",
        title: `Added client ${name}`,
        meta: { clientId: client._id, name },
      });

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

      // ─── Fire sequence triggers (best-effort; never blocks the response) ───
      if (sequenceModels) {
        enrollOnClientCreated(sequenceModels, client).catch(() => {});
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

      // Capture the prior doc to (a) fire stage_changed only on a real transition and
      // (b) build a before→after change summary for the activity feed.
      const before = await Client.findOne(
        { _id: req.params.id, userId: req.userId },
      ).lean();
      const prevStage = before?.stage ?? null;

      const client = await Client.findOneAndUpdate(
        { _id: req.params.id, userId: req.userId },
        { $set: updates },
        { returnDocument: "after", runValidators: true },
      ).lean();

      if (!client) {
        return res.status(404).json({ error: "Client not found." });
      }

      // ─── Fire stage_changed trigger on a genuine transition (best-effort) ───
      if (sequenceModels && updates.stage !== undefined && prevStage !== client.stage) {
        enrollOnStageChanged(sequenceModels, client, prevStage, client.stage).catch(() => {});
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
      const changes = buildClientChanges(before, client, updates);
      logActivity({
        userId: req.userId,
        category: "client",
        action: "updated",
        title: `Updated ${client.name}`,
        meta: { clientId: client._id, name: client.name, changes },
      });
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
      logActivity({
        userId: req.userId,
        category: "client",
        action: "deleted",
        title: `Deleted client ${client.name}`,
        meta: { name: client.name },
      });
      res.json({ success: true, message: "Client deleted." });
    } catch (err) {
      console.error("Error deleting client:", err.message);
      res.status(500).json({ error: "Failed to delete client." });
    }
  });

  return router;
}
