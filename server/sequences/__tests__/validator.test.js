import test from "node:test";
import assert from "node:assert/strict";
import registry from "../blocks/index.js";
import { validateGraph } from "../validator.js";
import { node, edge, simpleSendGraph } from "./_fixtures.js";

const ok = (g) => validateGraph(g, registry).ok;
const errs = (g) => validateGraph(g, registry).errors.map((e) => e.message).join(" | ");

test("a minimal trigger -> send -> end graph is valid", () => {
  assert.equal(ok(simpleSendGraph()), true, errs(simpleSendGraph()));
});

test("rejects a graph with no trigger", () => {
  const g = simpleSendGraph();
  g.nodes = g.nodes.filter((n) => n.type !== "client_created");
  g.edges = g.edges.filter((e) => e.source !== "t");
  assert.equal(ok(g), false);
});

test("rejects two triggers", () => {
  const g = simpleSendGraph();
  g.nodes.push(node("t2", "manual_enroll", "trigger"));
  assert.equal(ok(g), false);
});

test("rejects an orphan (unreachable) node", () => {
  const g = simpleSendGraph();
  g.nodes.push(node("orphan", "notify_broker", "action", { message: "hi" }));
  g.edges.push(edge("orphan", "e"));
  assert.match(errs(g), /Unreachable/);
});

test("rejects a dead-end that cannot reach an end", () => {
  // trigger -> notify (out has no edge) ... no path to end
  const g = {
    nodes: [node("t", "client_created", "trigger"), node("n", "notify_broker", "action", { message: "x" }), node("e", "end", "exit")],
    edges: [edge("t", "n")], // n has no outgoing edge
  };
  assert.equal(ok(g), false);
});

test("rejects an invalid edge handle", () => {
  const g = simpleSendGraph();
  g.edges = [edge("t", "s"), edge("s", "e", "bogus")];
  assert.match(errs(g), /invalid handle|Missing edge/);
});

test("condition must wire every branch handle", () => {
  const g = {
    nodes: [
      node("t", "client_created", "trigger"),
      node("c", "condition", "control", { field: "client.intent", cases: [{ op: "eq", value: "hot", handle: "hot" }], elseHandle: "else" }),
      node("s", "send_whatsapp", "action", { body: "hi" }),
      node("e", "end", "exit"),
    ],
    edges: [edge("t", "c"), edge("c", "s", "hot"), edge("s", "e")], // missing "else" edge
  };
  assert.match(errs(g), /Missing edge for handle "else"/);
});

test("rejects unknown merge tokens in a send body", () => {
  const g = simpleSendGraph("Hi {client.bogus}");
  assert.match(errs(g), /Unknown merge field/);
});

test("rejects unknown block type (e.g. voice in MVP)", () => {
  const g = simpleSendGraph();
  g.nodes[1] = node("s", "voice_call", "action", {});
  assert.match(errs(g), /Unknown block type/);
});

test("rejects a loop with no wait (would send with no pause)", () => {
  const g = {
    nodes: [
      node("t", "client_created", "trigger"),
      node("c", "condition", "control", { field: "client.intent", cases: [{ op: "eq", value: "hot", handle: "loop" }], elseHandle: "out" }),
      node("s", "send_whatsapp", "action", { body: "hi" }),
      node("e", "end", "exit"),
    ],
    edges: [edge("t", "c"), edge("c", "s", "loop"), edge("s", "c"), edge("c", "e", "out")], // c<->s cycle, no wait
  };
  assert.match(errs(g), /Loop without a wait/);
});

test("accepts a loop that contains a wait", () => {
  const g = {
    nodes: [
      node("t", "client_created", "trigger"),
      node("c", "condition", "control", { field: "client.intent", cases: [{ op: "eq", value: "hot", handle: "loop" }], elseHandle: "out" }),
      node("s", "send_whatsapp", "action", { body: "hi" }),
      node("w", "wait", "control", { value: 3, unit: "days" }),
      node("e", "end", "exit"),
    ],
    edges: [edge("t", "c"), edge("c", "s", "loop"), edge("s", "w"), edge("w", "c"), edge("c", "e", "out")],
  };
  assert.equal(ok(g), true, errs(g));
});
