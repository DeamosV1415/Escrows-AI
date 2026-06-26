import { ToolRegistry } from "../../agent/registry.js";
import { compileAgentGraph } from "../../agent/graph.js";
import registerSequenceTools from "./tools.js";
import { buildSequencePrompt } from "./prompts.js";

/**
 * Build the constrained Sequences sub-agent: the SAME LangGraph wiring the copilot uses
 * (router → agent → confirm_gate → tools), but bound to its own small tool registry and
 * system prompt. The wiring reads both from `config.configurable` at run time, so we just
 * hand the route a `{ graph, registry, buildSystemPrompt }` bundle to pass per request.
 */
export function buildSequenceAgentGraph(models) {
  const registry = new ToolRegistry(); // isolated — not the global copilot singleton
  registerSequenceTools(registry, models);

  const graph = compileAgentGraph();
  console.log(`✅ Sequences sub-agent compiled (${registry.size()} tools)`);
  return { graph, registry, buildSystemPrompt: buildSequencePrompt };
}
