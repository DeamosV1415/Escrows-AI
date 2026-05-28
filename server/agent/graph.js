import { StateGraph, END } from "@langchain/langgraph";
import AgentState from "./state.js";
import registry from "./registry.js";
import {
  routerNode,        routeFromRouter,
  agentNode,         routeFromAgent,
  confirmGateNode,   routeFromConfirmGate,
  toolsNode,
} from "./nodes.js";

import registerClientTools      from "./tools/client_tools.js";
import registerContactTools     from "./tools/contact_tools.js";
import registerMessageTools     from "./tools/message_tools.js";
import registerInventoryTools   from "./tools/inventory_tools.js";
import registerDashboardTools   from "./tools/dashboard_tools.js";
import registerIntegrationTools from "./tools/integration_tools.js";
import registerProfileTools     from "./tools/profile_tools.js";

export function buildAgentGraph(models) {
  // Idempotent registration — survives nodemon reloads.
  if (registry.size() === 0) {
    registerClientTools(registry, models);
    registerContactTools(registry, models);
    registerMessageTools(registry, models);
    registerInventoryTools(registry, models);
    registerDashboardTools(registry, models);
    registerIntegrationTools(registry, models);
    registerProfileTools(registry, models);
    console.log(`🛠  Agent registry: ${registry.size()} tools loaded`);
  }

  const graph = new StateGraph(AgentState)
    .addNode("router",       routerNode)
    .addNode("agent",        agentNode)
    .addNode("confirm_gate", confirmGateNode)
    .addNode("tools",        toolsNode)
    .addEdge("__start__",    "router")
    .addConditionalEdges("router", routeFromRouter, {
      agent:        "agent",
      confirm_gate: "confirm_gate",
    })
    .addConditionalEdges("agent", routeFromAgent, {
      confirm_gate: "confirm_gate",
      end:          END,
    })
    .addConditionalEdges("confirm_gate", routeFromConfirmGate, {
      tools: "tools",
      end:   END,
    })
    .addEdge("tools", "agent")
    .compile();

  console.log("✅ Agent graph compiled");
  return graph;
}

export { registry };
