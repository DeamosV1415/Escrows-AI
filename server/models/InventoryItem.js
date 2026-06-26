import mongoose from "mongoose";

const inventoryItemSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["folder", "file"],
      required: true,
    },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0 },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    storagePath: { type: String, default: "" }, // legacy disk path (pre-GridFS)
    gridfsFileId: { type: mongoose.Schema.Types.ObjectId, default: null }, // legacy GridFS
    r2Key: { type: String, default: "" }, // Cloudflare R2 object key (current storage)
  },
  { timestamps: true },
);

// Text index for search
inventoryItemSchema.index({ name: "text" });

// Compound index for listing folder contents
inventoryItemSchema.index({ clientId: 1, parentId: 1 });

export default inventoryItemSchema;
