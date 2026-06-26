import test from "node:test";
import assert from "node:assert/strict";
import registerSequenceTools, { normalizeGraph } from "../agent/tools.js";
import { ToolRegistry } from "../../agent/registry.js";
import { buildSequenceAgentGraph } from "../agent/graph.js";
import { TEMPLATES } from "../templates.js";

/** A raw, LLM-style graph (no family, no edge ids, no positions) derived from a template. */
function rawGraphFromTemplate(t) {
  const g = JSON.parse(JSON.stringify(t.graph));
  return {
    nodes: g.nodes.map((n) => ({ id: n.id, type: n.type, config: n.config })),
    edges: g.edges.map((e) => ({ source: e.source, target: e.target, handle: e.handle })),
  };
}

function makeReg() {
  const created = [];
  const updated = [];
  const SequenceMock = {
    async create(doc) { const s = { ...doc, _id: "newseq1" }; created.push(s); return s; },
    async findOne(q) {
      if (q._id !== "exists1") return null;
      const doc = { _id: "exists1", userId: q.userId, status: "draft", version: 1, name: "old", graph: {}, async save() { updated.push(this); } };
      return doc;
    },
  };
  const reg = new ToolRegistry();
  registerSequenceTools(reg, { Sequence: SequenceMock });
  return { reg, created, updated, SequenceMock };
}

test("sub-agent exposes exactly the 5 constrained tools", () => {
  const { graph, registry } = buildSequenceAgentGraph({ Sequence: {} });
  assert.ok(graph);
  const names = registry.list().map((t) => t.name).sort();
  assert.deepEqual(names, ["get_block_catalog", "list_templates", "lookup_merge_fields", "save_sequence", "validate_sequence"]);
});

test("only save_sequence is sensitive; catalog tools are free", () => {
  const { reg } = makeReg();
  assert.equal(reg.get("save_sequence").sensitive, true);
  assert.equal(reg.get("validate_sequence").sensitive, false);
  assert.equal(reg.get("list_templates").creditCost, 0);
});

test("normalizeGraph fills node.family, edge ids and handles", () => {
  const n = normalizeGraph({
    nodes: [{ id: "t", type: "client_created", config: {} }, { id: "s", type: "send_whatsapp", config: { body: "hi" } }],
    edges: [{ source: "t", target: "s" }],
  });
  assert.equal(n.nodes[0].family, "trigger");
  assert.equal(n.nodes[1].family, "action");
  assert.equal(n.edges[0].handle, "out");
  assert.ok(n.edges[0].id.length > 0);
});

test("validate_sequence accepts a raw template graph and rejects a broken one", async () => {
  const { reg } = makeReg();
  const validate = reg.get("validate_sequence").handler;

  const good = await validate({ graph: rawGraphFromTemplate(TEMPLATES[0]) });
  assert.equal(good.ok, true, JSON.stringify(good.errors));

  const bad = await validate({
    graph: {
      nodes: [{ id: "t", type: "client_created", config: {} }, { id: "x", type: "send_carrier_pigeon", config: {} }],
      edges: [{ source: "t", target: "x", handle: "out" }],
    },
  });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.map((e) => e.message).join(" | "), /Unknown block type/);
});

test("save_sequence saves a valid graph as a DRAFT and returns a builder link", async () => {
  const { reg, created } = makeReg();
  const save = reg.get("save_sequence").handler;
  const r = await save({ name: "AI New Lead", graph: rawGraphFromTemplate(TEMPLATES[0]) }, "user1", { models: {} });
  assert.equal(r.ok, true);
  assert.equal(r.status, "draft");
  assert.equal(r.sequenceId, "newseq1");
  assert.match(r.builderUrl, /\/dashboard\/sequences\/newseq1\/edit/);
  assert.equal(created.length, 1);
  assert.equal(created[0].status, "draft");
});

test("save_sequence REFUSES to save an invalid graph (nothing created)", async () => {
  const { reg, created } = makeReg();
  const save = reg.get("save_sequence").handler;
  const r = await save({
    name: "Bad",
    graph: { nodes: [{ id: "t", type: "client_created", config: {} }], edges: [] },
  }, "user1", { models: {} });
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
  assert.equal(created.length, 0);
});

test("save_sequence with sequenceId updates the existing draft instead of creating", async () => {
  const { reg, created, updated } = makeReg();
  const save = reg.get("save_sequence").handler;
  const r = await save(
    { sequenceId: "exists1", name: "Edited", graph: rawGraphFromTemplate(TEMPLATES[0]) },
    "user1",
    { models: {} },
  );
  assert.equal(r.ok, true);
  assert.equal(r.sequenceId, "exists1");
  assert.equal(created.length, 0);
  assert.equal(updated.length, 1);
});
