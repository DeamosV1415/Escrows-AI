import { unknownTokens } from "./merge.js";

/**
 * The shared graph validator — run on every canvas-save AND every AI generation. A free
 * canvas (and an LLM) can draw malformed graphs; this is the single gate that keeps invalid
 * sequences out of the engine. Returns { ok, errors: [{ message, nodeId?, edgeId? }] }.
 *
 * Rules:
 *  1. Exactly one trigger node (the entry).
 *  2. At least one end node; every node can reach an end (no dead-ends).
 *  3. No orphan/unreachable nodes.
 *  4. Each node's config is Zod-valid; every merge token is in the known vocabulary.
 *  5. Every edge handle is valid for its source block; required handles are all wired;
 *     no duplicate handle on a node; end nodes have no outgoing edges.
 *  6. No unbounded loop: any cycle must contain a `wait`.
 *  Unknown block types (incl. voice/sms in MVP) are rejected because they aren't registered.
 */
export function validateGraph(graph, registry) {
  const errors = [];
  const err = (message, ref = {}) => errors.push({ message, ...ref });
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const done = () => ({ ok: errors.length === 0, errors });

  if (!Array.isArray(nodes) || nodes.length === 0) {
    err("Graph has no nodes");
    return done();
  }

  // ── unique ids ──
  const idSet = new Set();
  for (const n of nodes) {
    if (!n.id) err("Node missing id");
    else if (idSet.has(n.id)) err(`Duplicate node id: ${n.id}`, { nodeId: n.id });
    else idSet.add(n.id);
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // ── per-node type + config + merge validation ──
  for (const n of nodes) {
    const block = registry.get(n.type);
    if (!block) {
      err(`Unknown block type: ${n.type}`, { nodeId: n.id });
      continue;
    }
    if (block.family !== n.family) {
      err(`Node family "${n.family}" does not match block family "${block.family}"`, { nodeId: n.id });
    }
    const parsed = block.configSchema.safeParse(n.config || {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        err(`config.${issue.path.join(".") || "(root)"}: ${issue.message}`, { nodeId: n.id });
      }
    }
    for (const key of block.mergeFields) {
      const unknown = unknownTokens((n.config || {})[key]);
      if (unknown.length) err(`Unknown merge field(s) in ${key}: ${unknown.join(", ")}`, { nodeId: n.id });
    }
  }

  // ── exactly one trigger; at least one end ──
  const triggers = nodes.filter((n) => registry.get(n.type)?.family === "trigger");
  if (triggers.length !== 1) err(`Graph must have exactly one trigger (found ${triggers.length})`);
  const entry = triggers[0];
  const ends = nodes.filter((n) => registry.get(n.type)?.family === "exit");
  if (ends.length === 0) err("Graph must have at least one end node");

  // ── edge endpoints exist ──
  for (const e of edges) {
    if (!nodeById.has(e.source)) err(`Edge source not found: ${e.source}`, { edgeId: e.id });
    if (!nodeById.has(e.target)) err(`Edge target not found: ${e.target}`, { edgeId: e.id });
  }

  // ── outgoing handle coverage ──
  const outByNode = new Map(); // nodeId -> Map(handle -> targets[])
  for (const e of edges) {
    if (!outByNode.has(e.source)) outByNode.set(e.source, new Map());
    const m = outByNode.get(e.source);
    if (!m.has(e.handle)) m.set(e.handle, []);
    m.get(e.handle).push(e.target);
  }
  for (const n of nodes) {
    const block = registry.get(n.type);
    if (!block) continue;
    const valid = registry.handlesFor(n.type, n.config || {});
    const out = outByNode.get(n.id) || new Map();
    for (const h of out.keys()) {
      if (!valid.includes(h)) err(`Edge with invalid handle "${h}" for ${n.type}`, { nodeId: n.id });
    }
    for (const [h, targets] of out) {
      if (targets.length > 1) err(`Multiple edges for handle "${h}" (ambiguous)`, { nodeId: n.id });
    }
    if (block.family === "exit") {
      if (out.size) err("End node must have no outgoing edges", { nodeId: n.id });
    } else {
      for (const h of valid) if (!out.has(h)) err(`Missing edge for handle "${h}"`, { nodeId: n.id });
    }
  }

  if (!entry) return done(); // can't do graph traversal without an entry

  // adjacency (only over existing nodes)
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (adj.has(e.source) && nodeById.has(e.target)) adj.get(e.source).push(e.target);
  }

  // ── reachability from entry (orphans) ──
  const reachable = bfs(entry.id, adj);
  for (const n of nodes) {
    if (!reachable.has(n.id)) err("Unreachable from the trigger (orphan)", { nodeId: n.id });
  }

  // ── termination: every reachable non-exit node can reach an end ──
  const radj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (radj.has(e.target) && nodeById.has(e.source)) radj.get(e.target).push(e.source);
  }
  const canReachEnd = new Set();
  for (const endN of ends) for (const id of bfs(endN.id, radj)) canReachEnd.add(id);
  for (const n of nodes) {
    if (registry.get(n.type)?.family === "exit") continue;
    if (reachable.has(n.id) && !canReachEnd.has(n.id)) {
      err("No path from this node reaches an end (dead-end)", { nodeId: n.id });
    }
  }

  // ── unbounded loop: every cycle must contain a wait ──
  for (const comp of tarjan(nodes.map((n) => n.id), adj)) {
    const isCycle = comp.length > 1 || (comp.length === 1 && (adj.get(comp[0]) || []).includes(comp[0]));
    if (!isCycle) continue;
    const hasWait = comp.some((id) => nodeById.get(id)?.type === "wait");
    if (!hasWait) err(`Loop without a wait step (would send with no pause): ${comp.join(", ")}`);
  }

  return done();
}

function bfs(start, adj) {
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const x = q.shift();
    for (const y of adj.get(x) || []) {
      if (!seen.has(y)) {
        seen.add(y);
        q.push(y);
      }
    }
  }
  return seen;
}

// Tarjan's strongly-connected-components — used to find cycles.
function tarjan(ids, adj) {
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const out = [];

  const strongconnect = (v) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) || []) {
      if (!idx.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), idx.get(w)));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      out.push(comp);
    }
  };

  for (const v of ids) if (!idx.has(v)) strongconnect(v);
  return out;
}
