import { z } from "zod";
import mongoose from "mongoose";
import { enrollOnClientCreated, enrollOnStageChanged } from "../../sequences/triggers.js";
import { logActivity } from "../../utils/activityLog.js";

const STAGES  = ["Lead", "Engaged", "Under Contract", "Closed"];
const INTENTS = ["hot", "warm", "cold"];

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function projectClient(c) {
  return {
    id: String(c._id),
    name: c.name,
    email: c.email,
    company: c.company,
    phone: c.phone,
    stage: c.stage,
    intent: c.intent,
    budget: c.budget,
    requirements: c.requirements,
    nextAction: c.nextAction,
    nextActionPriority: c.nextActionPriority,
    notes: c.notes,
    updatedAt: c.updatedAt,
  };
}

export default function registerClientTools(registry, models) {
  const { Client, InventoryItem, TrackedContact } = models;

  registry.register({
    category: "clients",
    name: "search_clients",
    description: "List or search the user's clients/leads. Filter by stage, intent (hot/warm/cold), or sort. Always use this to resolve a client's id before update/delete.",
    creditCost: 1,
    sensitive: false,
    schema: z.object({
      search: z.string().optional().describe("Name / email / company substring"),
      stage:  z.enum(["all", ...STAGES]).optional(),
      intent: z.enum(["all", ...INTENTS]).optional(),
      sort:   z.enum(["activity", "name", "budget", "created"]).optional(),
      limit:  z.number().int().min(1).max(100).optional(),
    }),
    handler: async (args, userId) => {
      const filter = { userId };
      if (args.search?.trim()) {
        const s = escapeRegex(args.search.trim());
        filter.$or = [
          { name:    { $regex: s, $options: "i" } },
          { email:   { $regex: s, $options: "i" } },
          { company: { $regex: s, $options: "i" } },
        ];
      }
      if (args.stage  && args.stage  !== "all") filter.stage  = args.stage;
      if (args.intent && args.intent !== "all") filter.intent = args.intent;

      const sortMap = {
        activity: { updatedAt: -1 },
        name:     { name: 1 },
        budget:   { budget: -1 },
        created:  { createdAt: -1 },
      };
      const sort = sortMap[args.sort || "activity"];
      const limit = args.limit || 25;

      const rows = await Client.find(filter).sort(sort).limit(limit).lean();
      return { count: rows.length, clients: rows.map(projectClient) };
    },
  });

  registry.register({
    category: "clients",
    name: "get_client",
    description: "Fetch full details of a single client by id.",
    creditCost: 1,
    sensitive: false,
    schema: z.object({
      clientId: z.string().describe("MongoDB ObjectId of the client"),
    }),
    handler: async ({ clientId }, userId) => {
      if (!mongoose.isValidObjectId(clientId)) throw new Error("Invalid clientId");
      const c = await Client.findOne({ _id: clientId, userId }).lean();
      if (!c) throw new Error("Client not found.");
      return projectClient(c);
    },
  });

  registry.register({
    category: "clients",
    name: "create_client",
    description: "Create a new client/lead. Also auto-creates a tracked contact and an inventory root folder for them. Name + email required.",
    creditCost: 2,
    sensitive: true,
    buildDescription: (a) =>
      `Create ${a.intent ? `**${a.intent}** ` : ""}${a.stage ? `**${a.stage}** ` : ""}client **${a.name}**` +
      (a.email ? ` (${a.email})` : "") +
      (a.company ? ` at ${a.company}` : "") +
      (a.budget ? ` — budget $${Number(a.budget).toLocaleString()}` : "") + "?",
    schema: z.object({
      name:    z.string().min(1),
      email:   z.string().email(),
      company: z.string().optional(),
      phone:   z.string().optional(),
      stage:   z.enum(STAGES).optional(),
      intent:  z.enum(INTENTS).optional(),
      budget:  z.number().nonnegative().optional(),
      requirements: z.string().optional(),
      nextAction:   z.string().optional(),
      nextActionPriority: z.enum(["high", "medium", "low"]).optional(),
      notes:   z.string().optional(),
    }),
    handler: async (a, userId) => {
      const client = await Client.create({
        userId,
        name: a.name,
        email: a.email.toLowerCase(),
        company: a.company || "",
        phone: a.phone || "",
        stage: a.stage || "Lead",
        intent: a.intent || "warm",
        budget: a.budget || 0,
        requirements: a.requirements || "",
        nextAction: a.nextAction || "",
        nextActionPriority: a.nextActionPriority || "medium",
        notes: a.notes || "",
      });

      // Mirror /api/clients POST: auto-create TrackedContact
      try {
        const exists = await TrackedContact.findOne({ userId, email: client.email });
        if (!exists) {
          await TrackedContact.create({
            userId,
            name: client.name,
            email: client.email,
            phone: client.phone,
            source: "client",
            clientRef: client._id,
            channels: { gmail: true, whatsapp: !!client.phone, sms: !!client.phone },
          });
        }
      } catch (e) {
        if (e.code !== 11000) console.error("create_client → TrackedContact failed:", e.message);
      }

      // Mirror /api/clients POST: auto-create inventory root folder
      try {
        const folderName = client.company ? `${client.name} - ${client.company}` : client.name;
        await InventoryItem.create({
          userId,
          clientId: client._id,
          name: folderName,
          type: "folder",
          parentId: null,
        });
      } catch (e) {
        console.error("create_client → inventory folder failed:", e.message);
      }

      // Fire client_created sequence triggers (best-effort; mirrors the UI route).
      enrollOnClientCreated(models, client).catch(() => {});

      // Record in the dashboard's Recent Activity, tagged as AI-performed.
      logActivity({
        userId,
        category: "client",
        action: "created",
        title: `Added client ${client.name}`,
        meta: { clientId: client._id, name: client.name, source: "ai" },
      });

      return { success: true, client: projectClient(client.toObject()) };
    },
  });

  registry.register({
    category: "clients",
    name: "update_client",
    description: "Update fields of an existing client. Pass clientId + only the fields to change. Syncs inventory folder name when name/company changes.",
    creditCost: 2,
    sensitive: true,
    buildDescription: async (a, ctx) => {
      const changes = Object.entries(a)
        .filter(([k, v]) => k !== "clientId" && v !== undefined && v !== "")
        .map(([k, v]) => `**${k}** → ${v}`)
        .join(", ");
      const c = await Client.findOne({ _id: a.clientId, userId: ctx?.userId }).select("name").lean().catch(() => null);
      const label = c ? `**${c.name}**` : `client \`${a.clientId}\``;
      return `Update ${label}: ${changes || "no changes"}?`;
    },
    schema: z.object({
      clientId: z.string(),
      name:    z.string().optional(),
      email:   z.string().email().optional(),
      company: z.string().optional(),
      phone:   z.string().optional(),
      stage:   z.enum(STAGES).optional(),
      intent:  z.enum(INTENTS).optional(),
      budget:  z.number().nonnegative().optional(),
      requirements: z.string().optional(),
      nextAction:   z.string().optional(),
      nextActionPriority: z.enum(["high", "medium", "low"]).optional(),
      notes:   z.string().optional(),
    }),
    handler: async (a, userId) => {
      const { clientId, ...rest } = a;
      if (!mongoose.isValidObjectId(clientId)) throw new Error("Invalid clientId");

      const updates = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) updates[k] = k === "email" ? v.toLowerCase() : v;
      }
      if (Object.keys(updates).length === 0) {
        throw new Error("No fields to update.");
      }

      // Capture prior stage for the stage_changed trigger.
      let prevStage = null;
      if (updates.stage !== undefined) {
        const before = await Client.findOne({ _id: clientId, userId }, { stage: 1 }).lean();
        prevStage = before?.stage ?? null;
      }

      const client = await Client.findOneAndUpdate(
        { _id: clientId, userId },
        { $set: updates },
        { returnDocument: "after", runValidators: true },
      ).lean();
      if (!client) throw new Error("Client not found.");

      // Fire stage_changed trigger on a genuine transition (best-effort).
      if (updates.stage !== undefined && prevStage !== client.stage) {
        enrollOnStageChanged(models, client, prevStage, client.stage).catch(() => {});
      }

      if (updates.name || updates.company) {
        const folderName = client.company ? `${client.name} - ${client.company}` : client.name;
        await InventoryItem.findOneAndUpdate(
          { clientId: client._id, parentId: null, type: "folder", userId },
          { $set: { name: folderName } },
        ).catch(() => {});
      }

      logActivity({
        userId,
        category: "client",
        action: "updated",
        title: `Updated ${client.name}`,
        meta: { clientId: client._id, name: client.name, source: "ai" },
      });

      return { success: true, client: projectClient(client) };
    },
  });

  registry.register({
    category: "clients",
    name: "delete_client",
    description: "Permanently delete a client AND all their inventory items AND their linked tracked contact. Cannot be undone.",
    creditCost: 3,
    sensitive: true,
    buildDescription: async (a, ctx) => {
      const c = await Client.findOne({ _id: a.clientId, userId: ctx?.userId }).select("name company").lean().catch(() => null);
      const label = c ? `**${c.name}**${c.company ? ` (${c.company})` : ""}` : `client \`${a.clientId}\``;
      return `**Permanently delete** ${label} along with **all their inventory files/folders** and their tracked contact. This cannot be undone. Proceed?`;
    },
    schema: z.object({ clientId: z.string() }),
    handler: async ({ clientId }, userId, { gridfsBucket }) => {
      if (!mongoose.isValidObjectId(clientId)) throw new Error("Invalid clientId");
      const client = await Client.findOneAndDelete({ _id: clientId, userId });
      if (!client) throw new Error("Client not found.");

      // Cascade: GridFS files + InventoryItems
      const items = await InventoryItem.find({ clientId: client._id, userId }).lean();
      let removedFiles = 0;
      if (gridfsBucket) {
        for (const it of items) {
          if (it.type === "file" && it.gridfsFileId) {
            try { await gridfsBucket.delete(it.gridfsFileId); removedFiles++; } catch {}
          }
        }
      }
      const inv = await InventoryItem.deleteMany({ clientId: client._id, userId });

      // Cascade: tracked contact
      await TrackedContact.deleteOne({ userId, clientRef: client._id }).catch(() => {});

      logActivity({
        userId,
        category: "client",
        action: "deleted",
        title: `Deleted client ${client.name}`,
        meta: { name: client.name, source: "ai" },
      });

      return {
        success: true,
        deleted: { name: client.name, email: client.email },
        cascadedInventoryItems: inv.deletedCount,
        cascadedFiles: removedFiles,
      };
    },
  });
}
