import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import mongoose from "mongoose";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsRoot = path.join(__dirname, "..", "uploads");

// Ensure uploads dir exists
if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });

// Multer disk storage
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const clientDir = path.join(uploadsRoot, req.body.clientId || "misc");
    if (!fs.existsSync(clientDir)) fs.mkdirSync(clientDir, { recursive: true });
    cb(null, clientDir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

export default function createInventoryRouter(InventoryItem) {
  const router = express.Router();

  // ─── GET /api/inventory ───
  // Query: clientId, parentId, search
  router.get("/", async (req, res) => {
    try {
      const { clientId, parentId, search } = req.query;
      const filter = {};

      if (clientId) filter.clientId = new mongoose.Types.ObjectId(clientId);

      if (search && search.trim()) {
        const s = search.trim();
        filter.name = { $regex: s, $options: "i" };
      } else {
        // Browsing a specific folder
        if (parentId && parentId !== "null") {
          filter.parentId = new mongoose.Types.ObjectId(parentId);
        } else {
          filter.parentId = null;
        }
      }

      const items = await InventoryItem.find(filter)
        .sort({ type: 1, name: 1 }) // folders first, then alpha
        .lean();

      res.json(items);
    } catch (err) {
      console.error("Error fetching inventory:", err.message);
      res.status(500).json({ error: "Failed to fetch inventory." });
    }
  });

  // ─── GET /api/inventory/counts ───
  // Returns { parentId: { files: N, folders: N } } for given parent IDs
  router.get("/counts", async (req, res) => {
    try {
      const { parentIds } = req.query;
      if (!parentIds) return res.json({});

      const ids = parentIds.split(",").filter(Boolean);
      const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));

      const result = await InventoryItem.aggregate([
        { $match: { parentId: { $in: objectIds } } },
        {
          $group: {
            _id: { parentId: "$parentId", type: "$type" },
            count: { $sum: 1 },
          },
        },
      ]);

      // Build map: { parentId: { files: N, folders: N } }
      const counts = {};
      for (const id of ids) {
        counts[id] = { files: 0, folders: 0 };
      }
      for (const r of result) {
        const pid = r._id.parentId.toString();
        if (counts[pid]) {
          if (r._id.type === "file") counts[pid].files = r.count;
          else counts[pid].folders = r.count;
        }
      }

      res.json(counts);
    } catch (err) {
      console.error("Error fetching counts:", err.message);
      res.status(500).json({ error: "Failed to fetch counts." });
    }
  });

  // ─── GET /api/inventory/:id ───
  router.get("/:id", async (req, res) => {
    try {
      const item = await InventoryItem.findById(req.params.id).lean();
      if (!item) return res.status(404).json({ error: "Item not found." });
      res.json(item);
    } catch (err) {
      console.error("Error fetching item:", err.message);
      res.status(500).json({ error: "Failed to fetch item." });
    }
  });

  // ─── GET /api/inventory/:id/ancestors ───
  // Returns breadcrumb chain from root → current
  router.get("/:id/ancestors", async (req, res) => {
    try {
      const ancestors = [];
      let currentId = req.params.id;

      // Walk up the tree (max 20 levels to prevent infinite loops)
      for (let i = 0; i < 20; i++) {
        const item = await InventoryItem.findById(currentId).lean();
        if (!item) break;
        ancestors.unshift({ _id: item._id, name: item.name, type: item.type });
        if (!item.parentId) break;
        currentId = item.parentId;
      }

      res.json(ancestors);
    } catch (err) {
      console.error("Error fetching ancestors:", err.message);
      res.status(500).json({ error: "Failed to fetch ancestors." });
    }
  });

  // ─── POST /api/inventory/folder ───
  router.post("/folder", async (req, res) => {
    try {
      const { clientId, name, parentId } = req.body;

      if (!clientId || !name) {
        return res
          .status(400)
          .json({ error: "clientId and name are required." });
      }

      const folder = new InventoryItem({
        clientId,
        name: name.trim(),
        type: "folder",
        parentId: parentId || null,
      });

      await folder.save();
      console.log(`📁 Folder created: ${name}`);
      res.status(201).json(folder.toObject());
    } catch (err) {
      console.error("Error creating folder:", err.message);
      res.status(500).json({ error: "Failed to create folder." });
    }
  });

  // ─── POST /api/inventory/upload ───
  router.post("/upload", upload.single("file"), async (req, res) => {
    try {
      const { clientId, parentId } = req.body;
      const file = req.file;

      if (!clientId || !file) {
        return res
          .status(400)
          .json({ error: "clientId and file are required." });
      }

      const item = new InventoryItem({
        clientId,
        name: file.originalname,
        type: "file",
        mimeType: file.mimetype,
        size: file.size,
        parentId: parentId || null,
        storagePath: file.path,
      });

      await item.save();
      console.log(`📄 File uploaded: ${file.originalname}`);
      res.status(201).json(item.toObject());
    } catch (err) {
      console.error("Error uploading file:", err.message);
      res.status(500).json({ error: "Failed to upload file." });
    }
  });

  // ─── PUT /api/inventory/:id ───
  router.put("/:id", async (req, res) => {
    try {
      const { name } = req.body;
      const item = await InventoryItem.findByIdAndUpdate(
        req.params.id,
        { $set: { name: name.trim() } },
        { new: true, runValidators: true },
      ).lean();

      if (!item) return res.status(404).json({ error: "Item not found." });

      console.log(`✏️  Renamed: ${item.name}`);
      res.json(item);
    } catch (err) {
      console.error("Error renaming item:", err.message);
      res.status(500).json({ error: "Failed to rename item." });
    }
  });

  // ─── DELETE /api/inventory/:id ───
  // Recursive delete for folders
  router.delete("/:id", async (req, res) => {
    try {
      const item = await InventoryItem.findById(req.params.id);
      if (!item) return res.status(404).json({ error: "Item not found." });

      if (item.type === "folder") {
        // Recursively collect all descendants
        const toDelete = [item._id];
        const queue = [item._id];

        while (queue.length > 0) {
          const pid = queue.shift();
          const children = await InventoryItem.find({ parentId: pid }).lean();
          for (const child of children) {
            toDelete.push(child._id);
            if (child.type === "folder") queue.push(child._id);
            // Delete physical file
            if (child.type === "file" && child.storagePath) {
              try {
                fs.unlinkSync(child.storagePath);
              } catch {}
            }
          }
        }

        await InventoryItem.deleteMany({ _id: { $in: toDelete } });
        console.log(
          `🗑️  Folder deleted (${toDelete.length} items): ${item.name}`,
        );
      } else {
        // Single file
        if (item.storagePath) {
          try {
            fs.unlinkSync(item.storagePath);
          } catch {}
        }
        await InventoryItem.findByIdAndDelete(req.params.id);
        console.log(`🗑️  File deleted: ${item.name}`);
      }

      res.json({ success: true, message: "Deleted." });
    } catch (err) {
      console.error("Error deleting item:", err.message);
      res.status(500).json({ error: "Failed to delete item." });
    }
  });

  // ─── GET /api/inventory/:id/download ───
  // Stream file for preview/download
  router.get("/:id/download", async (req, res) => {
    try {
      const item = await InventoryItem.findById(req.params.id).lean();
      if (!item || item.type !== "file") {
        return res.status(404).json({ error: "File not found." });
      }

      if (!item.storagePath || !fs.existsSync(item.storagePath)) {
        return res.status(404).json({ error: "File not found on disk." });
      }

      const stat = fs.statSync(item.storagePath);
      res.setHeader("Content-Length", stat.size);
      res.setHeader(
        "Content-Type",
        item.mimeType || "application/octet-stream",
      );
      res.setHeader("Content-Disposition", `inline; filename="${item.name}"`);
      fs.createReadStream(item.storagePath).pipe(res);
    } catch (err) {
      console.error("Error downloading file:", err.message);
      res.status(500).json({ error: "Failed to download file." });
    }
  });

  return router;
}
