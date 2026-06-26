import { z } from "zod";
import blockRegistry from "../blocks/index.js";
import { validateGraph } from "../validator.js";
import { TEMPLATES } from "../templates.js";
import { KNOWN_MERGE_FIELDS } from "../merge.js";
import { triggerOf } from "../templates.js";

/**
 * The constrained toolset for the Sequences sub-agent. These are the ONLY actions it
 * can take. It can read the block catalog / templates / merge vocabulary, validate a
 * draft graph against the same shared validator the canvas uses, and save a DRAFT
 * sequence. It can never activate, enroll, or send — those stay with the broker.
 *
 * Tool handler signature matches the copilot tools: (parsedArgs, userId, { models }).
 */

// ── Zod shapes the LLM emits. The real structural checks live in validateGraph;
//    these are deliberately permissive so a near-miss still reaches the validator
//    (which returns precise, fixable errors) instead of being rejected as bad args.
const nodeZ = z.object({
  id: z.string(),
  type: z.string(),
  family: z.enum(["trigger", "action", "control", "exit"]).optional(),
  config: z.record(z.any()).optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});
const edgeZ = z.object({
  id: z.string().optional(),
  source: z.string(),
  target: z.string(),
  handle: z.string().optional(),
});
const graphZ = z.object({
  nodes: z.array(nodeZ),
  edges: z.array(edgeZ).default([]),
});

/**
 * Fill in the bits the LLM reliably forgets so the validator judges intent, not typos:
 * node.family (authoritative from the registry), default config {}, default position,
 * edge.id and edge.handle. Returns a clean { nodes, edges }.
 */
export function normalizeGraph(graph) {
  const nodes = (graph?.nodes || []).map((n, i) => {
    const block = blockRegistry.get(n.type);
    return {
      id: n.id,
      type: n.type,
      family: block?.family || n.family || "action",
      config: n.config || {},
      position: n.position || { x: 240 * (i % 4), y: 140 * Math.floor(i / 4) },
    };
  });
  const edges = (graph?.edges || []).map((e) => {
    const handle = e.handle || "out";
    return { id: e.id || `${e.source}__${handle}__${e.target}`, source: e.source, target: e.target, handle };
  });
  return { nodes, edges };
}

export default function registerSequenceTools(registry, { Sequence }) {
  // ── list_templates ──────────────────────────────────────────────────────
  registry.register({
    category: "catalog",
    name: "list_templates",
    description: "List the built-in sequence templates (name, what they do, trigger). Prefer adapting a matching template over building from scratch.",
    creditCost: 0,
    sensitive: false,
    schema: z.object({}),
    handler: async () =>
      TEMPLATES.map((t) => ({
        key: t.key,
        name: t.name,
        description: t.description,
        trigger: triggerOf(t.graph).triggerType,
        steps: t.graph.nodes.length,
      })),
  });

  // ── get_block_catalog ───────────────────────────────────────────────────
  registry.register({
    category: "catalog",
    name: "get_block_catalog",
    description: "Get the full catalog of block types you may use, grouped by family, with each block's valid outgoing handles and merge fields. These are the ONLY block types that exist.",
    creditCost: 0,
    sensitive: false,
    schema: z.object({}),
    handler: async () => ({
      summary: blockRegistry.buildPromptCatalog(),
      blocks: blockRegistry.toCatalog(),
    }),
  });

  // ── lookup_merge_fields ─────────────────────────────────────────────────
  registry.register({
    category: "catalog",
    name: "lookup_merge_fields",
    description: "List the personalization merge tokens you may use inside message/subject/body fields (e.g. {client.firstName}, {broker.name}). Any token not in this list is rejected at save time.",
    creditCost: 0,
    sensitive: false,
    schema: z.object({}),
    handler: async () => ({ mergeFields: KNOWN_MERGE_FIELDS }),
  });

  // ── validate_sequence ───────────────────────────────────────────────────
  registry.register({
    category: "catalog",
    name: "validate_sequence",
    description: "Validate a draft sequence graph against the shared rules (one trigger, all handles wired, every path reaches an end, no unbounded loops, known blocks + merge tokens). Call this and fix every error BEFORE save_sequence. Returns { ok, errors }.",
    creditCost: 0,
    sensitive: false,
    schema: z.object({ graph: graphZ }),
    handler: async ({ graph }) => {
      const normalized = normalizeGraph(graph);
      const v = validateGraph(normalized, blockRegistry);
      return { ok: v.ok, errors: v.errors, nodeCount: normalized.nodes.length };
    },
  });

  // ── save_sequence (sensitive — confirm-gated) ───────────────────────────
  registry.register({
    category: "sequence",
    name: "save_sequence",
    description: "Save the draft sequence. Always validates first and REFUSES to save an invalid graph. Saves as status 'draft' only (never activates). Pass sequenceId to update an existing draft you're editing, otherwise omit it to create a new one. Returns { sequenceId, builderUrl } — share the builder link with the user.",
    creditCost: 5,
    sensitive: true,
    schema: z.object({
      sequenceId: z.string().optional(),
      name: z.string().min(1),
      description: z.string().optional(),
      graph: graphZ,
    }),
    buildDescription: async (args) => {
      const n = (args.graph?.nodes || []).length;
      const verb = args.sequenceId ? "Update the draft" : "Save a new draft sequence";
      return `${verb} **${args.name}** (${n} step${n === 1 ? "" : "s"})?`;
    },
    handler: async (args, userId, { models }) => {
      const SeqModel = Sequence || models?.Sequence;
      const graph = normalizeGraph(args.graph);
      const v = validateGraph(graph, blockRegistry);
      if (!v.ok) {
        return {
          ok: false,
          error: "Sequence is invalid — not saved. Fix these and try again.",
          errors: v.errors,
        };
      }
      const { triggerType, triggerConfig } = triggerOf(graph);

      let seq;
      if (args.sequenceId) {
        seq = await SeqModel.findOne({ _id: args.sequenceId, userId });
        if (!seq) return { ok: false, error: "Sequence not found." };
        seq.name = args.name;
        if (args.description !== undefined) seq.description = args.description;
        seq.graph = graph;
        seq.triggerType = triggerType;
        seq.triggerConfig = triggerConfig;
        // The sub-agent only ever produces drafts for broker review.
        if (seq.status === "active") seq.version += 1;
        await seq.save();
      } else {
        seq = await SeqModel.create({
          userId,
          name: args.name,
          description: args.description || "",
          status: "draft",
          version: 1,
          triggerType,
          triggerConfig,
          graph,
        });
      }

      const id = String(seq._id);
      const builderUrl = `/dashboard/sequences/${id}/edit`;
      return {
        ok: true,
        sequenceId: id,
        name: seq.name,
        status: seq.status,
        applied: true,
        builderUrl,
        steps: graph.nodes.length,
        message: `Saved draft **${seq.name}** (${graph.nodes.length} steps). [Open in builder](${builderUrl}) to review and activate.`,
      };
    },
  });

  return registry;
}
