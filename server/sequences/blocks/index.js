import BlockRegistry from "../registry.js";
import registerTriggers from "./triggers.js";
import registerActions from "./actions.js";
import registerControl from "./control.js";
import registerExit from "./exit.js";

/** Build a fully-populated block registry (the catalog). */
export function buildBlockRegistry() {
  const registry = new BlockRegistry();
  registerTriggers(registry);
  registerActions(registry);
  registerControl(registry);
  registerExit(registry);
  return registry;
}

// Shared singleton — the engine, validator, routes, and AI sub-agent all use this.
const blockRegistry = buildBlockRegistry();
export default blockRegistry;
