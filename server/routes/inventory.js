import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import mongoose from "mongoose";

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

export default function createInventoryRouter(InventoryItem, dbConnection) {
  const router = express.Router();

  // ─── GridFS bucket on the same DB connection ───
  const bucket = new mongoose.mongo.GridFSBucket(dbConnection.db, {
    bucketName: "Inventory",
  });

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

      const safeName = sanitizeFilename(file.originalname);

      // ─── Write file buffer to GridFS ───
      const gridfsFileId = await new Promise((resolve, reject) => {
        const uploadStream = bucket.openUploadStream(safeName, {
          contentType: file.mimetype,
          metadata: {
            userId: req.userId,
            clientId,
            originalName: file.originalname,
          },
        });

        uploadStream.on("error", reject);
        uploadStream.on("finish", () => resolve(uploadStream.id));
        uploadStream.end(file.buffer);
      });

      const item = new InventoryItem({
        userId: req.userId,
        clientId,
        name: safeName,
        type: "file",
        mimeType: file.mimetype,
        size: file.size,
        parentId: parentId || null,
        gridfsFileId,
      });

      await item.save();
      console.log(`📄 File uploaded to GridFS: ${safeName}`);
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

      // Helper: delete a file's GridFS data (and legacy disk file if present)
      const deleteFileData = async (doc) => {
        if (doc.gridfsFileId) {
          try {
            await bucket.delete(doc.gridfsFileId);
          } catch (e) {
            console.warn(`⚠️ GridFS delete failed for ${doc.name}:`, e.message);
          }
        }
        // Legacy cleanup: remove disk file if it exists from old uploads
        if (doc.storagePath) {
          try { fs.unlinkSync(doc.storagePath); } catch {}
        }
      };

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
            // Delete file data from GridFS / legacy disk
            if (child.type === "file") {
              await deleteFileData(child);
            }
          }
        }

        await InventoryItem.deleteMany({ _id: { $in: toDelete } });
        console.log(
          `🗑️  Folder deleted (${toDelete.length} items): ${item.name}`,
        );
      } else {
        // Single file
        await deleteFileData(item);
        await InventoryItem.findOneAndDelete({ _id: req.params.id, userId: req.userId });
        console.log(`🗑️  File deleted: ${item.name}`);
      }

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

      // ─── Serve from GridFS ───
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
