import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import sequenceSchema from "../../models/Sequence.js";
import sequenceEnrollmentSchema from "../../models/SequenceEnrollment.js";
import sequenceEventSchema from "../../models/SequenceEvent.js";
import sequenceSettingsSchema from "../../models/SequenceSettings.js";
import notificationSchema from "../../models/Notification.js";
import documentRequestSchema from "../../models/DocumentRequest.js";
import clientSchema from "../../models/Client.js";
import messageSchema from "../../models/Message.js";
import inventoryItemSchema from "../../models/InventoryItem.js";

import registry from "../blocks/index.js";
import { validateGraph } from "../validator.js";
import { enrollClient, tick, wakeAwaitingDocument } from "../engine.js";
import { shouldHalt } from "../guards.js";
import { resolveMerge } from "../merge.js";
import { getTemplate, triggerOf } from "../templates.js";

const URI = process.env.MONGODB_URI;
const noop = { skip: !URI ? "no MONGODB_URI" : false };

/* ─────────────── pure unit tests (no DB) ─────────────── */

test("wait_until: future date → delays until then", async () => {
  const block = registry.get("wait_until");
  const now = new Date("2026-06-14T12:00:00Z");
  const closing = new Date("2026-06-20T00:00:00Z");
  const d = await block.execute({
    node: { config: { dateField: "transaction.closingDate" } },
    client: { transaction: { closingDate: closing } },
    now,
  });
  assert.equal(d.kind, "delay");
  assert.equal(d.ms, closing.getTime() - now.getTime());
});

test("wait_until: offset N days before the date", async () => {
  const block = registry.get("wait_until");
  const now = new Date("2026-06-14T12:00:00Z");
  const closing = new Date("2026-06-20T00:00:00Z");
  const d = await block.execute({
    node: { config: { dateField: "transaction.closingDate", offset: { value: 3, unit: "days", direction: "before" } } },
    client: { transaction: { closingDate: closing } },
    now,
  });
  assert.equal(d.kind, "delay");
  assert.equal(d.ms, closing.getTime() - 3 * 86_400_000 - now.getTime());
});

test("wait_until: past date → advances immediately", async () => {
  const block = registry.get("wait_until");
  const d = await block.execute({
    node: { config: { dateField: "transaction.closingDate" } },
    client: { transaction: { closingDate: new Date("2020-01-01T00:00:00Z") } },
    now: new Date("2026-06-14T12:00:00Z"),
  });
  assert.equal(d.kind, "next");
  assert.equal(d.handle, "out");
});

test("wait_until: missing date → skips, never stalls", async () => {
  const block = registry.get("wait_until");
  const d = await block.execute({
    node: { config: { dateField: "transaction.closingDate" } },
    client: { transaction: {} },
    now: new Date(),
  });
  assert.equal(d.kind, "next");
  assert.equal(d.skipped, "no_date");
});

test("shouldHalt: stopOnClosed=false keeps a Closed deal running (Contract-to-Close)", async () => {
  const r = await shouldHalt({}, { clientId: "x" }, { stage: "Closed" }, { stopOnClosed: false, stopOnReply: false });
  assert.equal(r.halt, false);
});

test("shouldHalt: stopOnClosed=true halts a Closed deal (default sequences)", async () => {
  const r = await shouldHalt({}, { clientId: "x" }, { stage: "Closed" }, { stopOnClosed: true, stopOnReply: false });
  assert.equal(r.halt, true);
  assert.equal(r.reason, "deal_closed");
});

test("merge resolves transaction date tokens", () => {
  const out = resolveMerge("Closing on {transaction.closingDate}, status {transaction.status}", {
    client: { transaction: { closingDate: new Date("2026-06-20T00:00:00Z"), status: "loan" } },
  });
  assert.match(out, /Closing on .*2026/);
  assert.match(out, /status loan/);
});

test("Contract-to-Close template validates", () => {
  const t = getTemplate("contract-to-close");
  const r = validateGraph(t.graph, registry);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(triggerOf(t.graph).triggerType, "stage_changed");
});

/* ─────────────── integration tests (DB) ─────────────── */

let conn, models, userId;

test.before(async () => {
  if (!URI) return;
  conn = await mongoose.createConnection(URI, { dbName: "EscrowsAI_seq_test_p2" }).asPromise();
  models = {
    Sequence: conn.model("Sequence", sequenceSchema),
    SequenceEnrollment: conn.model("SequenceEnrollment", sequenceEnrollmentSchema),
    SequenceEvent: conn.model("SequenceEvent", sequenceEventSchema),
    SequenceSettings: conn.model("SequenceSettings", sequenceSettingsSchema),
    Notification: conn.model("Notification", notificationSchema),
    DocumentRequest: conn.model("DocumentRequest", documentRequestSchema),
    Client: conn.model("Client", clientSchema),
    Message: conn.model("Message", messageSchema),
    InventoryItem: conn.model("InventoryItem", inventoryItemSchema),
    Connection: conn.model("Connection", new mongoose.Schema({}, { strict: false })),
    User: conn.model("User", new mongoose.Schema({}, { strict: false })),
  };
  userId = new mongoose.Types.ObjectId();
});

test.beforeEach(async () => {
  if (!URI) return;
  for (const m of Object.values(models)) await m.deleteMany({});
});

test.after(async () => {
  if (conn) await conn.dropDatabase().then(() => conn.close());
});

// Minimal graph: trigger → wait_for_document → received:end(goal) / timeout:end
function docWaitGraph() {
  return {
    nodes: [
      { id: "t", type: "manual_enroll", family: "trigger", config: {}, position: { x: 0, y: 0 } },
      { id: "wfd", type: "wait_for_document", family: "control", config: { timeout: { value: 5, unit: "days" }, docName: "Inspection report" }, position: { x: 0, y: 1 } },
      { id: "endR", type: "end", family: "exit", config: { goal: true, goalName: "doc_received" }, position: { x: 0, y: 2 } },
      { id: "endT", type: "end", family: "exit", config: {}, position: { x: 1, y: 2 } },
    ],
    edges: [
      { id: "e1", source: "t", target: "wfd", handle: "out" },
      { id: "e2", source: "wfd", target: "endR", handle: "received" },
      { id: "e3", source: "wfd", target: "endT", handle: "timeout" },
    ],
  };
}

async function makeSeq(graph, settings = {}) {
  const { triggerType, triggerConfig } = triggerOf(graph);
  return models.Sequence.create({ userId, name: "t", status: "active", version: 1, triggerType, triggerConfig, graph, settings });
}

test("wait_for_document: advances on 'received' when the request is marked received", noop, async () => {
  const graph = docWaitGraph();
  assert.equal(validateGraph(graph, registry).ok, true);
  const seq = await makeSeq(graph);
  const client = await models.Client.create({ userId, name: "Doc", email: "doc@x.io", stage: "Under Contract" });
  const enr = await enrollClient({ models, sequence: seq, clientId: client._id });

  // First tick arms the wait_for_document (waitContext set, nextRunAt = +timeout)
  await tick({ models, now: new Date() });
  let row = await models.SequenceEnrollment.findById(enr._id);
  assert.equal(row.status, "active");
  assert.equal(row.waitContext.nodeId, "wfd");

  // Broker marks the requested doc received → engine should follow 'received'
  await models.DocumentRequest.create({
    userId, clientId: client._id, enrollmentId: enr._id, nodeId: "wfd",
    docName: "Inspection report", status: "received", receivedAt: new Date(Date.now() + 1000),
  });
  const woke = await wakeAwaitingDocument(models, userId, client._id);
  assert.ok(woke >= 1);
  await tick({ models, now: new Date(Date.now() + 2000) });

  row = await models.SequenceEnrollment.findById(enr._id);
  assert.equal(row.status, "completed");
  assert.ok(row.history.some((h) => h.nodeId === "wfd" && h.handleFollowed === "received"));
});

test("wait_for_document: an unrelated upload does NOT satisfy the request", noop, async () => {
  const seq = await makeSeq(docWaitGraph());
  const client = await models.Client.create({ userId, name: "Unrel", email: "unrel@x.io", stage: "Under Contract" });
  const enr = await enrollClient({ models, sequence: seq, clientId: client._id });

  await tick({ models, now: new Date() });
  // A random file is uploaded — but no DocumentRequest is marked received.
  await models.InventoryItem.create({ userId, clientId: client._id, name: "random.pdf", type: "file" });
  await wakeAwaitingDocument(models, userId, client._id);
  await tick({ models, now: new Date(Date.now() + 2000) });

  const row = await models.SequenceEnrollment.findById(enr._id);
  assert.equal(row.status, "active"); // still waiting, not advanced
  assert.equal(row.waitContext.nodeId, "wfd");
  assert.ok(!row.history.some((h) => h.nodeId === "wfd" && h.handleFollowed === "received"));
});

test("wait_for_document: follows 'timeout' when no file arrives", noop, async () => {
  const graph = docWaitGraph();
  const seq = await makeSeq(graph);
  const client = await models.Client.create({ userId, name: "NoDoc", email: "nodoc@x.io", stage: "Under Contract" });
  const enr = await enrollClient({ models, sequence: seq, clientId: client._id });

  await tick({ models, now: new Date() });
  // Jump past the timeout window; no document uploaded
  const later = new Date(Date.now() + 6 * 86_400_000);
  await models.SequenceEnrollment.updateOne({ _id: enr._id }, { $set: { nextRunAt: later } });
  await tick({ models, now: later });

  const row = await models.SequenceEnrollment.findById(enr._id);
  assert.equal(row.status, "completed");
  assert.ok(row.history.some((h) => h.nodeId === "wfd" && h.handleFollowed === "timeout"));
});

test("request_documents creates a pending, trackable DocumentRequest", noop, async () => {
  const client = await models.Client.create({ userId, name: "Req", email: "req@x.io" });
  const enrollment = { _id: new mongoose.Types.ObjectId(), userId, sequenceId: new mongoose.Types.ObjectId() };
  const block = registry.get("request_documents");
  const d = await block.execute({
    models, enrollment, client, dryRun: false,
    node: { id: "rd1", config: { channel: "email", docName: "Inspection report", body: "Please upload the report." } },
  });
  assert.equal(d.kind, "send");
  const dr = await models.DocumentRequest.findOne({ enrollmentId: enrollment._id, nodeId: "rd1" }).lean();
  assert.ok(dr, "a DocumentRequest row was created");
  assert.equal(dr.status, "pending");
  assert.equal(dr.docName, "Inspection report");
});

test("Contract-to-Close: a Closed client keeps running (does not halt)", noop, async () => {
  const t = getTemplate("contract-to-close");
  const graph = JSON.parse(JSON.stringify(t.graph));
  const seq = await makeSeq(graph, t.settings);
  // Client already Closed with no deadline dates — every wait_until should skip, none should halt.
  const client = await models.Client.create({
    userId, name: "Closer", email: "close@x.io", stage: "Closed",
    transaction: { status: "closed" },
  });
  const enr = await enrollClient({ models, sequence: seq, clientId: client._id });
  await tick({ models, now: new Date() });
  const row = await models.SequenceEnrollment.findById(enr._id);
  // It must NOT be halted by deal_closed; it either completed or is still progressing.
  assert.notEqual(row.status, "halted");
});
