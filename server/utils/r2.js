// ─── Cloudflare R2 storage helper ───
// R2 is S3-compatible, so we talk to it with the AWS S3 v3 SDK.
// All inventory file bytes live in R2; MongoDB only stores metadata + the r2Key.
//
// NOTE: env is read lazily (inside functions), never at module load. This module
// is imported by the route files before index.js calls dotenv.config(), so
// capturing process.env at the top level would see empty values.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

/** True only when every required R2 credential is present in the environment. */
export function r2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME,
  );
}

function bucket() {
  return process.env.R2_BUCKET_NAME;
}

let _client = null;
function client() {
  if (!r2Configured()) {
    throw new Error("R2 storage is not configured (missing R2_* env vars).");
  }
  if (!_client) {
    _client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

/** Upload a buffer to R2 under `key`. Returns the key on success. */
export async function uploadToR2(key, buffer, contentType) {
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType || "application/octet-stream",
    }),
  );
  return key;
}

/**
 * Fetch an object from R2. Returns the Node Readable stream plus metadata.
 * Caller is responsible for piping `body` to the response.
 */
export async function getR2Object(key) {
  const out = await client().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
  );
  return {
    body: out.Body, // Node.js Readable in the v3 SDK runtime
    contentLength: out.ContentLength,
    contentType: out.ContentType,
  };
}

/** Delete an object from R2. Best-effort — logs but never throws. */
export async function deleteFromR2(key) {
  if (!key) return;
  try {
    await client().send(
      new DeleteObjectCommand({ Bucket: bucket(), Key: key }),
    );
  } catch (err) {
    console.warn(`⚠️ R2 delete failed for ${key}:`, err.message);
  }
}

/**
 * Delete the physical blob backing an inventory file doc, wherever it lives:
 *   R2 (r2Key) → legacy GridFS (gridfsFileId) → legacy disk (storagePath).
 * Centralizes the fallback logic shared by the route handler, the agent tool,
 * and the client cascade-delete so the rules live in exactly one place.
 */
export async function purgeInventoryBlob(doc, gridfsBucket) {
  if (!doc) return;

  if (doc.r2Key) {
    await deleteFromR2(doc.r2Key);
  }

  if (doc.gridfsFileId && gridfsBucket) {
    try {
      await gridfsBucket.delete(doc.gridfsFileId);
    } catch (err) {
      console.warn(`⚠️ GridFS delete failed for ${doc.name}:`, err.message);
    }
  }

  if (doc.storagePath) {
    try {
      const fs = await import("fs");
      fs.unlinkSync(doc.storagePath);
    } catch {
      /* legacy disk file already gone — ignore */
    }
  }
}
