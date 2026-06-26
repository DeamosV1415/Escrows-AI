import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import mongoose from "mongoose";
import {
  uploadToR2,
  getR2Object,
  purgeInventoryBlob,
  r2Configured,
} from "../utils/r2.js";
import { getStorageLimitBytes } from "../config/plans.js";
import { logActivity } from "../utils/activityLog.js";

// ─── Multer memory storage (file stays in RAM as buffer) ───
const storage = multer.memoryStorage();

// Allowed file types for upload
const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".csv", ".txt",
]);

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/csv",
  "text/plain",
]);

// Sanitize filename — strip path traversal and dangerous characters
function sanitizeFilename(name) {
  return name
    .replace(/[/\\]/g, "_") // Replace path separators
    .replace(/\.\./g, "_")  // Remove directory traversal
    .replace(/[^a-zA-Z0-9._\- ]/g, "_") // Keep only safe chars
    .substring(0, 200); // Limit length
}

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error(`File type ${ext} is not allowed.`));
    }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      return cb(new Error(`MIME type ${file.mimetype} is not allowed.`));
    }
    cb(null, true);
  },
});

export default function createInventoryRouter(InventoryItem, dbConnection, User) {
  const router = express.Router();

  // ─── Legacy GridFS bucket (download/delete fallback for pre-R2 files) ───
  const bucket = new mongoose.mongo.GridFSBucket(dbConnection.db, {
    bucketName: "Inventory",
  });

  // ─── Storage accounting helpers ───
  // Live aggregation on the indexed userId field — always correct, no counter
  // drift. Cheap at free-tier scale; swap for a cached counter if it ever grows.
  async function getUsedBytes(userId) {
    const rows = await InventoryItem.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), type: "file" } },
      { $group: { _id: null, total: { $sum: "$size" } } },
    ]);
    return rows.length ? rows[0].total : 0;
  }

  // Reads the user's plan; defaults to "free" so storage logic never breaks
  // before onboarding plan-selection is wired up.
  async function getUserPlan(userId) {
    if (!User) return "free";
    const u = await User.findById(userId).select("plan").lean();
    return u?.plan || "free";
  }

  // ─── GET /api/inventory ───
  // Query: clientId, parentId, search
  router.get("/", async (req, res) => {
    try {
      const { clientId, parentId, search } = req.query;
      const filter = { userId: req.userId };

      if (clientId) filter.clientId = new mongoose.Types.ObjectId(clientId);

      if (search && search.trim()) {
        const s = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
        { $match: { parentId: { $in: objectIds }, userId: new mongoose.Types.ObjectId(req.userId) } },
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

  // ─── GET /api/inventory/usage ───
  // Storage usage for the current user's plan (drives the storage bar).
  // Declared before /:id so "usage" isn't captured as an item id.
  router.get("/usage", async (req, res) => {
    try {
      const [usedBytes, plan] = await Promise.all([
        getUsedBytes(req.userId),
        getUserPlan(req.userId),
      ]);
      res.json({ plan, usedBytes, limitBytes: getStorageLimitBytes(plan) });
    } catch (err) {
      console.error("Error fetching storage usage:", err.message);
      res.status(500).json({ error: "Failed to fetch storage usage." });
    }
  });

  // ─── GET /api/inventory/:id ───
  router.get("/:id", async (req, res) => {
    try {
      const item = await InventoryItem.findOne({ _id: req.params.id, userId: req.userId }).lean();
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
        const item = await InventoryItem.findOne({ _id: currentId, userId: req.userId }).lean();
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
        userId: req.userId,
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
  // File is held in memory (req.file.buffer), then written to GridFS
  router.post("/upload", (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        const message = err.message || "File upload failed.";
        return res.status(400).json({ error: message });
      }
      next();
    });
  }, async (req, res) => {
    try {
      const { clientId, parentId } = req.body;
      const file = req.file;

      if (!clientId || !file) {
        return res
          .status(400)
          .json({ error: "clientId and file are required." });
      }

      if (!r2Configured()) {
        return res
          .status(503)
          .json({ error: "File storage is not configured." });
      }

      // ─── Enforce the user's plan storage limit ───
      const [usedBytes, plan] = await Promise.all([
        getUsedBytes(req.userId),
        getUserPlan(req.userId),
      ]);
      const limitBytes = getStorageLimitBytes(plan);
      if (usedBytes + file.size > limitBytes) {
        return res.status(413).json({
          error:
            "Storage limit reached. Free up space or upgrade your plan to upload more.",
          usedBytes,
          limitBytes,
        });
      }

      const safeName = sanitizeFilename(file.originalname);

      // ─── Write file buffer to R2 ───
      // Stable key based on a random UUID — survives renames and plan changes
      // since the exact key is persisted on the doc.
      const r2Key = `inventory/${req.userId}/${crypto.randomUUID()}-${safeName}`;
      await uploadToR2(r2Key, file.buffer, file.mimetype);

      const item = new InventoryItem({
        userId: req.userId,
        clientId,
        name: safeName,
        type: "file",
        mimeType: file.mimetype,
        size: file.size,
        parentId: parentId || null,
        r2Key,
      });

      await item.save();
      console.log(`📄 File uploaded to R2: ${r2Key}`);
      logActivity({
        userId: req.userId,
        category: "inventory",
        action: "uploaded",
        title: `Uploaded ${safeName}`,
        meta: { itemId: item._id, name: safeName, clientId },
      });
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
      const item = await InventoryItem.findOneAndUpdate(
        { _id: req.params.id, userId: req.userId },
        { $set: { name: name.trim() } },
        { returnDocument: "after", runValidators: true },
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
      const item = await InventoryItem.findOne({ _id: req.params.id, userId: req.userId });
      if (!item) return res.status(404).json({ error: "Item not found." });

      if (item.type === "folder") {
        // Recursively collect all descendants
        const toDelete = [item._id];
        const queue = [item._id];

        while (queue.length > 0) {
          const pid = queue.shift();
          const children = await InventoryItem.find({ parentId: pid, userId: req.userId }).lean();
          for (const child of children) {
            toDelete.push(child._id);
            if (child.type === "folder") queue.push(child._id);
            // Purge the underlying blob (R2 → legacy GridFS → legacy disk)
            if (child.type === "file") {
              await purgeInventoryBlob(child, bucket);
            }
          }
        }

        await InventoryItem.deleteMany({ _id: { $in: toDelete } });
        console.log(
          `🗑️  Folder deleted (${toDelete.length} items): ${item.name}`,
        );
      } else {
        // Single file
        await purgeInventoryBlob(item, bucket);
        await InventoryItem.findOneAndDelete({ _id: req.params.id, userId: req.userId });
        console.log(`🗑️  File deleted: ${item.name}`);
      }

      logActivity({
        userId: req.userId,
        category: "inventory",
        action: "deleted",
        title: `Deleted ${item.type === "folder" ? "folder" : "file"} ${item.name}`,
        meta: { name: item.name, type: item.type, clientId: item.clientId },
      });

      res.json({ success: true, message: "Deleted." });
    } catch (err) {
      console.error("Error deleting item:", err.message);
      res.status(500).json({ error: "Failed to delete item." });
    }
  });

  // ─── GET /api/inventory/:id/download ───
  // Stream file from GridFS for preview/download
  router.get("/:id/download", async (req, res) => {
    try {
      const item = await InventoryItem.findOne({ _id: req.params.id, userId: req.userId }).lean();
      if (!item || item.type !== "file") {
        return res.status(404).json({ error: "File not found." });
      }

      // ─── Serve from R2 (current storage) ───
      if (item.r2Key) {
        try {
          const obj = await getR2Object(item.r2Key);
          if (obj.contentLength != null) {
            res.setHeader("Content-Length", obj.contentLength);
          }
          res.setHeader(
            "Content-Type",
            item.mimeType || obj.contentType || "application/octet-stream",
          );
          res.setHeader("Content-Disposition", `inline; filename="${item.name}"`);
          // Cache repeat previews in the browser → avoids re-billing Class B ops
          res.setHeader("Cache-Control", "private, max-age=3600");

          obj.body.on("error", (err) => {
            console.error("R2 stream error:", err.message);
            if (!res.headersSent) {
              res.status(500).json({ error: "Failed to download file." });
            }
          });
          obj.body.pipe(res);
          return;
        } catch (err) {
          console.error("R2 download error:", err.message);
          return res.status(404).json({ error: "File not found in storage." });
        }
      }

      // ─── Legacy fallback: serve from GridFS ───
      if (item.gridfsFileId) {
        // Verify the GridFS file exists
        const cursor = bucket.find({ _id: item.gridfsFileId });
        const gridfsFile = await cursor.next();
        if (!gridfsFile) {
          return res.status(404).json({ error: "File not found in storage." });
        }

        res.setHeader("Content-Length", gridfsFile.length);
        res.setHeader(
          "Content-Type",
          item.mimeType || "application/octet-stream",
        );
        res.setHeader("Content-Disposition", `inline; filename="${item.name}"`);

        const downloadStream = bucket.openDownloadStream(item.gridfsFileId);
        downloadStream.on("error", (err) => {
          console.error("GridFS download error:", err.message);
          if (!res.headersSent) {
            res.status(500).json({ error: "Failed to download file." });
          }
        });
        downloadStream.pipe(res);
        return;
      }

      // ─── Legacy fallback: serve from disk (old uploads before GridFS) ───
      if (item.storagePath && fs.existsSync(item.storagePath)) {
        const stat = fs.statSync(item.storagePath);
        res.setHeader("Content-Length", stat.size);
        res.setHeader(
          "Content-Type",
          item.mimeType || "application/octet-stream",
        );
        res.setHeader("Content-Disposition", `inline; filename="${item.name}"`);
        fs.createReadStream(item.storagePath).pipe(res);
        return;
      }

      return res.status(404).json({ error: "File not found on disk." });
    } catch (err) {
      console.error("Error downloading file:", err.message);
      res.status(500).json({ error: "Failed to download file." });
    }
  });

  return router;
}
