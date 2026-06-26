import { z } from "zod";
import mongoose from "mongoose";
import { purgeInventoryBlob } from "../../utils/r2.js";
import { logActivity } from "../../utils/activityLog.js";

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function projectItem(i) {
  return {
    id: String(i._id),
    name: i.name,
    type: i.type,
    mimeType: i.mimeType,
    size: i.size,
    clientId: i.clientId ? String(i.clientId) : null,
    parentId: i.parentId ? String(i.parentId) : null,
    updatedAt: i.updatedAt,
  };
}

export default function registerInventoryTools(registry, { InventoryItem, Client }) {

  registry.register({
    category: "inventory",
    name: "list_inventory",
    description: "Browse the inventory tree. Pass clientId to scope to one client; parentId to descend into a folder; or search to text-search names. With no args, lists root-level items.",
    creditCost: 1,
    sensitive: false,
    schema: z.object({
      clientId: z.string().optional(),
      parentId: z.string().optional().describe("Folder id; omit or 'null' for root"),
      search:   z.string().optional(),
      limit:    z.number().int().min(1).max(200).optional(),
    }),
    handler: async (a, userId) => {
      const filter = { userId };
      if (a.clientId) {
        if (!mongoose.isValidObjectId(a.clientId)) throw new Error("Invalid clientId");
        filter.clientId = new mongoose.Types.ObjectId(a.clientId);
      }
      if (a.search?.trim()) {
        filter.name = { $regex: escapeRegex(a.search.trim()), $options: "i" };
      } else if (a.parentId && a.parentId !== "null") {
        if (!mongoose.isValidObjectId(a.parentId)) throw new Error("Invalid parentId");
        filter.parentId = new mongoose.Types.ObjectId(a.parentId);
      } else {
        filter.parentId = null;
      }
      const rows = await InventoryItem.find(filter)
        .sort({ type: 1, name: 1 })
        .limit(a.limit || 100)
        .lean();
      return { count: rows.length, items: rows.map(projectItem) };
    },
  });

  registry.register({
    category: "inventory",
    name: "get_inventory_item",
    description: "Fetch a single inventory item (file or folder) by id.",
    creditCost: 1,
    sensitive: false,
    schema: z.object({ itemId: z.string() }),
    handler: async ({ itemId }, userId) => {
      if (!mongoose.isValidObjectId(itemId)) throw new Error("Invalid itemId");
      const it = await InventoryItem.findOne({ _id: itemId, userId }).lean();
      if (!it) throw new Error("Item not found.");
      return projectItem(it);
    },
  });

  registry.register({
    category: "inventory",
    name: "get_breadcrumbs",
    description: "Return the ancestor chain (root → item) for a given inventory item. Useful for showing where a file lives.",
    creditCost: 1,
    sensitive: false,
    schema: z.object({ itemId: z.string() }),
    handler: async ({ itemId }, userId) => {
      if (!mongoose.isValidObjectId(itemId)) throw new Error("Invalid itemId");
      const chain = [];
      let id = itemId;
      for (let i = 0; i < 20; i++) {
        const it = await InventoryItem.findOne({ _id: id, userId }).lean();
        if (!it) break;
        chain.unshift({ id: String(it._id), name: it.name, type: it.type });
        if (!it.parentId) break;
        id = String(it.parentId);
      }
      return { breadcrumbs: chain };
    },
  });

  registry.register({
    category: "inventory",
    name: "create_folder",
    description: "Create a new folder inside a client's inventory tree.",
    creditCost: 1,
    sensitive: true,
    buildDescription: async (a, ctx) => {
      const c = await Client.findOne({ _id: a.clientId, userId: ctx?.userId }).select("name").lean().catch(() => null);
      const clientLabel = c ? `**${c.name}**` : `client \`${a.clientId}\``;
      let parentLabel = "";
      if (a.parentId) {
        const p = await InventoryItem.findOne({ _id: a.parentId, userId: ctx?.userId }).select("name").lean().catch(() => null);
        parentLabel = ` (inside ${p ? `**${p.name}**` : `parent \`${a.parentId}\``})`;
      } else {
        parentLabel = " (root)";
      }
      return `Create folder **${a.name}** under ${clientLabel}${parentLabel}?`;
    },
    schema: z.object({
      clientId: z.string(),
      name:     z.string().min(1),
      parentId: z.string().optional(),
    }),
    handler: async (a, userId) => {
      if (!mongoose.isValidObjectId(a.clientId)) throw new Error("Invalid clientId");
      const owns = await Client.exists({ _id: a.clientId, userId });
      if (!owns) throw new Error("Client not found.");
      if (a.parentId && !mongoose.isValidObjectId(a.parentId)) throw new Error("Invalid parentId");

      const folder = await InventoryItem.create({
        userId,
        clientId: a.clientId,
        name: a.name.trim(),
        type: "folder",
        parentId: a.parentId || null,
      });
      logActivity({
        userId,
        category: "inventory",
        action: "created",
        title: `Created folder ${folder.name}`,
        meta: { itemId: folder._id, name: folder.name, clientId: a.clientId, source: "ai" },
      });
      return { success: true, folder: projectItem(folder.toObject()) };
    },
  });

  registry.register({
    category: "inventory",
    name: "rename_inventory_item",
    description: "Rename a file or folder.",
    creditCost: 1,
    sensitive: true,
    buildDescription: async (a, ctx) => {
      const it = await InventoryItem.findOne({ _id: a.itemId, userId: ctx?.userId }).select("name").lean().catch(() => null);
      const label = it ? `**${it.name}**` : `\`${a.itemId}\``;
      return `Rename ${label} to **${a.name}**?`;
    },
    schema: z.object({
      itemId: z.string(),
      name:   z.string().min(1),
    }),
    handler: async (a, userId) => {
      if (!mongoose.isValidObjectId(a.itemId)) throw new Error("Invalid itemId");
      const it = await InventoryItem.findOneAndUpdate(
        { _id: a.itemId, userId },
        { $set: { name: a.name.trim() } },
        { returnDocument: "after", runValidators: true },
      ).lean();
      if (!it) throw new Error("Item not found.");
      logActivity({
        userId,
        category: "inventory",
        action: "updated",
        title: `Renamed ${it.type === "folder" ? "folder" : "file"} to ${it.name}`,
        meta: { itemId: it._id, name: it.name, source: "ai" },
      });
      return { success: true, item: projectItem(it) };
    },
  });

  registry.register({
    category: "inventory",
    name: "delete_inventory_item",
    description: "Permanently delete a file or folder. Folders delete all their contents recursively, including the underlying GridFS blobs.",
    creditCost: 2,
    sensitive: true,
    buildDescription: async (a, ctx) => {
      const it = await InventoryItem.findOne({ _id: a.itemId, userId: ctx?.userId }).select("name type").lean().catch(() => null);
      const label = it ? `${it.type === "folder" ? "folder" : "file"} **${it.name}**` : `item \`${a.itemId}\``;
      return `**Permanently delete** ${label}. Folders cascade-delete everything inside. Proceed?`;
    },
    schema: z.object({ itemId: z.string() }),
    handler: async ({ itemId }, userId, { gridfsBucket }) => {
      if (!mongoose.isValidObjectId(itemId)) throw new Error("Invalid itemId");
      const item = await InventoryItem.findOne({ _id: itemId, userId });
      if (!item) throw new Error("Item not found.");

      async function purgeFile(doc) {
        await purgeInventoryBlob(doc, gridfsBucket);
      }

      if (item.type === "folder") {
        const ids = [item._id];
        const queue = [item._id];
        let fileCount = 0;
        while (queue.length) {
          const pid = queue.shift();
          const kids = await InventoryItem.find({ parentId: pid, userId }).lean();
          for (const k of kids) {
            ids.push(k._id);
            if (k.type === "folder") queue.push(k._id);
            else { await purgeFile(k); fileCount++; }
          }
        }
        await InventoryItem.deleteMany({ _id: { $in: ids } });
        logActivity({
          userId,
          category: "inventory",
          action: "deleted",
          title: `Deleted folder ${item.name}`,
          meta: { name: item.name, type: "folder", clientId: item.clientId, source: "ai" },
        });
        return { success: true, type: "folder", deletedCount: ids.length, fileCount, name: item.name };
      }

      await purgeFile(item);
      await InventoryItem.findOneAndDelete({ _id: itemId, userId });
      logActivity({
        userId,
        category: "inventory",
        action: "deleted",
        title: `Deleted file ${item.name}`,
        meta: { name: item.name, type: "file", clientId: item.clientId, source: "ai" },
      });
      return { success: true, type: "file", deletedCount: 1, name: item.name };
    },
  });
}
