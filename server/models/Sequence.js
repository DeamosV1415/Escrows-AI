import mongoose from "mongoose";

/**
 * A Sequence is DATA, not code: a directed graph of typed block instances (nodes)
 * joined by edges. The engine is an interpreter that walks it. Templates,
 * hand-built sequences, and AI-generated ones are all this same shape.
 *
 * `graph.nodes[i].config` is validated against that block's Zod schema (from the
 * BlockRegistry) by the graph validator before any save. `edges[i].handle` is the
 * outcome the engine follows (e.g. "true"/"false", "replied"/"timeout", "out").
 */
const nodeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: { type: String, required: true }, // block type, e.g. "send_email"
    family: { type: String, enum: ["trigger", "action", "control", "exit"], required: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
  },
  { _id: false },
);

const edgeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    source: { type: String, required: true }, // node id
    target: { type: String, required: true }, // node id
    handle: { type: String, default: "out" }, // outcome this edge represents
  },
  { _id: false },
);

const settingsSchema = new mongoose.Schema(
  {
    timezone: { type: String, default: "UTC" },
    // Note: quiet hours are configured PER send node (send_email / send_whatsapp), not here,
    // so a broker can hold one message to business hours while another fires immediately.
    mode: { type: String, enum: ["auto", "approval"], default: "auto" },
    stopOnReply: { type: Boolean, default: true },
    stopOnClosed: { type: Boolean, default: true },
    maxPerClientPerDay: { type: Number, default: 2 },
    maxStepsPerEnrollment: { type: Number, default: 200 },
  },
  { _id: false },
);

const sequenceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: ["draft", "active", "paused", "archived"],
      default: "draft",
    },
    version: { type: Number, default: 1 },

    // Last time this sequence transitioned into "active". Used by the plan-cap sweep
    // to keep the most-recently-activated sequences running when a downgrade forces
    // auto-pausing the excess. null until first activated.
    activatedAt: { type: Date, default: null },

    // Denormalized from the trigger node for fast "which sequences fire on X?" lookups.
    triggerType: {
      type: String,
      enum: ["client_created", "stage_changed", "manual_enroll", "schedule"],
      required: true,
    },
    triggerConfig: { type: mongoose.Schema.Types.Mixed, default: {} },

    graph: {
      nodes: { type: [nodeSchema], default: [] },
      edges: { type: [edgeSchema], default: [] },
    },

    settings: { type: settingsSchema, default: () => ({}) },

    // Denormalized counters for the library/analytics cards.
    stats: {
      enrolled: { type: Number, default: 0 },
      active: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      halted: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },

    // Optional: built-in template key this sequence was instantiated from.
    templateKey: { type: String, default: null },
  },
  { timestamps: true },
);

sequenceSchema.index({ userId: 1, triggerType: 1, status: 1 });

export default sequenceSchema;
