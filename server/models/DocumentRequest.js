import mongoose from "mongoose";

/**
 * A document the broker asked a client for from inside a sequence (the request_documents
 * block). It is the explicit, trackable thing a wait_for_document step waits on — so an
 * unrelated inventory upload can never falsely satisfy a request, and the broker gets a
 * clear list of what's still outstanding per client.
 *
 * Lifecycle: request_documents creates one (pending) → broker marks it received (optionally
 * linking the uploaded file) → wait_for_document follows its "received" branch.
 */
const documentRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", default: null },
    sequenceId: { type: mongoose.Schema.Types.ObjectId, ref: "Sequence", default: null },
    enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: "SequenceEnrollment", default: null },
    nodeId: { type: String, default: null }, // the request_documents node that created it

    docName: { type: String, default: "Document" },
    status: { type: String, enum: ["pending", "received"], default: "pending" },
    fulfilledByItemId: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", default: null },
    receivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

documentRequestSchema.index({ userId: 1, clientId: 1, status: 1 });
// One request per (enrollment, node) so retries/re-entry don't create duplicates.
documentRequestSchema.index({ enrollmentId: 1, nodeId: 1 }, { unique: true, sparse: true });

export default documentRequestSchema;
