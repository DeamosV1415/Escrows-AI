import { z } from "zod";

/**
 * The single source of truth for block types — consumed by the engine (executors),
 * the graph validator (config schemas + valid handles), the canvas (palette), and the
 * AI sub-agent (capability catalog). Mirrors server/agent/registry.js (ToolRegistry).
 *
 * A block spec:
 *   {
 *     type:        "send_email",
 *     family:      "trigger" | "action" | "control" | "exit",
 *     label:       "Send email",
 *     description: "…",                       // for the AI catalog + palette tooltip
 *     configSchema: ZodType,                  // validates node.config
 *     handles:     ["out"] | (config) => [..],// valid outgoing edge handles
 *     mergeFields: ["subject","body"],        // config keys run through the merge resolver
 *     execute:     async (ctx) => directive,  // engine executor (see engine.js)
 *   }
 */
class BlockRegistry {
  constructor() {
    this._blocks = new Map();
    this._byFamily = new Map();
  }

  register(spec) {
    const { type, family, label, configSchema, execute } = spec;
    if (!type || !family || !configSchema || !execute) {
      throw new Error(`Block registration missing required fields: ${type}`);
    }
    if (this._blocks.has(type)) throw new Error(`Block "${type}" already registered`);
    if (!(configSchema instanceof z.ZodType)) {
      throw new Error(`Block "${type}" configSchema must be a Zod schema`);
    }
    const entry = {
      type,
      family,
      label: label || type,
      description: spec.description || "",
      configSchema,
      handles: spec.handles || ["out"],
      mergeFields: spec.mergeFields || [],
      execute,
    };
    this._blocks.set(type, entry);
    if (!this._byFamily.has(family)) this._byFamily.set(family, []);
    this._byFamily.get(family).push(type);
    return entry;
  }

  get(type) {
    return this._blocks.get(type) || null;
  }

  has(type) {
    return this._blocks.has(type);
  }

  list() {
    return [...this._blocks.values()];
  }

  /** Valid outgoing handles for a node, resolving dynamic (function) handle specs. */
  handlesFor(type, config) {
    const b = this._blocks.get(type);
    if (!b) return [];
    return typeof b.handles === "function" ? b.handles(config || {}) : b.handles;
  }

  /** Compact, schema-bearing catalog string for the AI sub-agent's system prompt. */
  buildPromptCatalog() {
    const lines = [];
    for (const [family, types] of this._byFamily) {
      lines.push(`\n### ${family.toUpperCase()} BLOCKS`);
      for (const type of types) {
        const b = this._blocks.get(type);
        const handles = typeof b.handles === "function" ? "(dynamic)" : b.handles.join(", ");
        lines.push(`- ${type} — ${b.description} | handles: ${handles}`);
      }
    }
    return lines.join("\n");
  }

  /** Palette payload for the canvas (GET /api/sequences/blocks). */
  toCatalog() {
    return this.list().map((b) => ({
      type: b.type,
      family: b.family,
      label: b.label,
      description: b.description,
      mergeFields: b.mergeFields,
      handles: typeof b.handles === "function" ? null : b.handles,
    }));
  }
}

export default BlockRegistry;
