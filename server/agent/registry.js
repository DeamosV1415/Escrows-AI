import { z } from "zod";
import { tool as makeStructuredTool } from "@langchain/core/tools";

class ToolRegistry {
  constructor() {
    this._tools = new Map();
    this._categories = new Map();
  }

  register(spec) {
    const {
      category,
      name,
      description,
      schema,
      handler,
      creditCost = 1,
      sensitive = false,
      buildDescription = null,
    } = spec;

    if (!name || !category || !handler || !schema) {
      throw new Error(`Tool registration missing required fields: ${name}`);
    }
    if (this._tools.has(name)) {
      throw new Error(`Tool "${name}" already registered`);
    }
    if (!(schema instanceof z.ZodType)) {
      throw new Error(`Tool "${name}" schema must be a Zod schema`);
    }

    const entry = {
      category, name, description, schema, handler,
      creditCost, sensitive, buildDescription,
    };
    this._tools.set(name, entry);
    if (!this._categories.has(category)) this._categories.set(category, []);
    this._categories.get(category).push(name);
    return entry;
  }

  get(name) {
    return this._tools.get(name) || null;
  }

  list() {
    return Array.from(this._tools.values());
  }

  size() {
    return this._tools.size;
  }

  /**
   * Build LangChain StructuredTool wrappers that the LLM can be bound against.
   * Handler is a stub — actual execution + credit debit happens in toolsNode.
   * The stub returns a placeholder; the graph never invokes it directly.
   */
  buildLLMTools() {
    return this.list().map((t) =>
      makeStructuredTool(
        async () => "[handled by graph]",
        {
          name: t.name,
          description: t.description,
          schema: t.schema,
        },
      ),
    );
  }

  /** A compact summary of capabilities for the system prompt. */
  buildPromptSummary() {
    const lines = [];
    for (const [cat, names] of this._categories) {
      lines.push(`\n### ${cat.toUpperCase()}`);
      for (const name of names) {
        const t = this._tools.get(name);
        const flag = t.sensitive ? " [sensitive — needs confirmation]" : "";
        lines.push(`- ${name} (${t.creditCost}c)${flag}: ${t.description}`);
      }
    }
    return lines.join("\n");
  }
}

const registry = new ToolRegistry();
export default registry;
