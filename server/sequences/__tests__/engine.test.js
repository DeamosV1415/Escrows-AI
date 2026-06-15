import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import dotenv from "dotenv";

import userSchema from "../../models/User.js";
import clientSchema from "../../models/Client.js";
import connectionSchema from "../../models/Connection.js";
import messageSchema from "../../models/Message.js";
import sequenceSchema from "../../models/Sequence.js";
import sequenceEnrollmentSchema from "../../models/SequenceEnrollment.js";
import sequenceEventSchema from "../../models/SequenceEvent.js";
import sequenceSettingsSchema from "../../models/SequenceSettings.js";

import { tick, enrollClient, dryRun, wakeAwaitingReply } from "../engine.js";
import { node, edge, simpleSendGraph, mockSenders, failingSenders } from "./_fixtures.js";

dotenv.config();

const NOON = new Date(Date.UTC(2026, 5, 1, 12, 0, 0)); // daytime UTC → outside default quiet hours

let conn = null;
let models = null;
let available = false;

before(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn("⚠️  engine.test.js skipped: MONGODB_URI not set");
    return;
  }
  try {
    conn = mongoose.createConnection(uri, { dbName: "EscrowsAI_seq_test", serverSelectionTimeoutMS: 8000 });
    await conn.asPromise();
    models = {
      User: conn.model("User", userSchema, "Users"),
      Client: conn.model("Client", clientSchema, "Clients"),
      Connection: conn.model("Connection", connectionSchema, "Connections"),
      Message: conn.model("Message", messageSchema, "Messages"),
      Sequence: conn.model("Sequence", sequenceSchema, "Sequences"),
      SequenceEnrollment: conn.model("SequenceEnrollment", sequenceEnrollmentSchema, "SequenceEnrollments"),
      SequenceEvent: conn.model("SequenceEvent", sequenceEventSchema, "SequenceEvents"),
      SequenceSettings: conn.model("SequenceSettings", sequenceSettingsSchema, "SequenceSettings"),
    };
    await models.SequenceEnrollment.syncIndexes();
    available = true;
  } catch (e) {
    console.warn("⚠️  engine.test.js skipped: cannot reach Mongo —", e.message);
  }
});

beforeEach(async () => {
  if (!available) return;
  await Promise.all(Object.values(models).map((m) => m.deleteMany({})));
});

after(async () => {
  if (conn) {
    await Promise.all(Object.values(models).map((m) => m.collection.drop().catch(() => {})));
    await conn.close();
  }
});

async function makeUser() {
  return models.User.create({ name: "Bea Broker", email: `b${Date.now()}@x.com`, company: "Acme Realty" });
}
async function makeClient(user, over = {}) {
  return models.Client.create({
    userId: user._id, name: "Sam Lee", email: "sam@x.com", phone: "4155550001",
    stage: "Lead", intent: "warm", ...over,
  });
}
async function makeSeq(user, graph, settings = {}) {
  const trigger = graph.nodes.find((n) => n.family === "trigger");
  return models.Sequence.create({
    userId: user._id, name: "Test Seq", status: "active", version: 1,
    triggerType: trigger.type, triggerConfig: trigger.config || {}, graph, settings,
  });
}

/* ───────────────────────── tests ───────────────────────── */

test("happy path: enroll → send (with merge) → complete", async (t) => {
  if (!available) return t.skip("no mongo");
  const user = await makeUser();
  const client = await makeClient(user);
  const seq = await makeSeq(user, simpleSendGraph("Hi {client.name}"));
  const enr = await enrollClient({ models, sequence: seq, clientId: client._id, now: NOON });
  assert.ok(enr);

  const mock = mockSenders(models);
  await tick({ models, senders: mock.senders, now: NOON });

  assert.equal(mock.calls.length, 1, "exactly one send");
  assert.equal(mock.calls[0].body, "Hi Sam Lee", "merge field resolved");
  const after = await models.SequenceEnrollment.findById(enr._id).lean();
  assert.equal(after.status, "completed");
  const sent = await models.SequenceEvent.countDocuments({ enrollmentId: enr._id, type: "message_sent" });
  assert.equal(sent, 1);
});

test("concurrency: two simultaneous ticks never double-send", async (t) => {
  if (!available) return t.skip("no mongo");
  const user = await makeUser();
  const client = await makeClient(user);
  const seq = await makeSeq(user, simpleSendGraph());
  await enrollClient({ models, sequence: seq, clientId: client._id, now: NOON });

  const mock = mockSenders(models);
  await Promise.all([
    tick({ models, senders: mock.senders, now: NOON, workerId: "A" }),
    tick({ models, senders: mock.senders, now: NOON, workerId: "B" }),
  ]);

  assert.equal(mock.calls.length, 1, "claim is atomic — only one worker sent");
  const outbound = await models.Message.countDocuments({ direction: "outbound" });
  assert.equal(outbound, 1);
});

test("idempotency / crash recovery: in-flight + already-sent message is adopted, not re-sent", async (t) => {
  if (!available) return t.skip("no mongo");
  const user = await makeUser();
  const client = await makeClient(user);
  const seq = await makeSeq(user, simpleSendGraph("Hi {client.name}"));
  const enr = await enrollClient({ models, sequence: seq, clientId: client._id, now: NOON });

  // Simulate a crash AFTER the provider sent but BEFORE we advanced:
  // a durable in-flight marker exists and a matching outbound message is on record.
  await models.Message.create({
    userId: user._id, channel: "whatsapp", contactIdentifier: "4155550001",
    direction: "outbound", body: "Hi Sam Lee", externalId: "wa_pre", status: "delivered",
    timestamp: new Date(NOON.getTime() - 500),
  });
  enr.inFlight = { nodeId: "s", body: "Hi Sam Lee", startedAt: new Date(NOON.getTime() - 1000) };
  await enr.save();

  const mock = mockSenders(models);
  await tick({ models, senders: mock.senders, now: NOON });

  assert.equal(mock.calls.length, 0, "did NOT re-send after crash");
  const outbound = await models.Message.countDocuments({ direction: "outbound" });
  assert.equal(outbound, 1, "only the pre-crash message exists");
  const after = await models.SequenceEnrollment.findById(enr._id).lean();
  assert.equal(after.status, "completed");
});

test("condition branches on client.intent (hot sends, cold skips)", async (t) => {
  if (!available) return t.skip("no mongo");
  const user = await makeUser();
  const graph = {
    nodes: [
      node("t", "manual_enroll", "trigger"),
      node("c", "condition", "control", { field: "client.intent", cases: [{ op: "eq", value: "hot", handle: "hot" }], elseHandle: "cold" }),
      node("s", "send_whatsapp", "action", { body: "hot lead!" }),
      node("e1", "end", "exit"),
      node("e2", "end", "exit"),
    ],
    edges: [edge("t", "c"), edge("c", "s", "hot"), edge("s", "e1"), edge("c", "e2", "cold")],
  };
  const seq = await makeSeq(user, graph);
  const hot = await makeClient(user, { intent: "hot", email: "hot@x.com", phone: "4155550010" });
  const cold = await makeClient(user, { intent: "cold", email: "cold@x.com", phone: "4155550011" });
  await enrollClient({ models, sequence: seq, clientId: hot._id, now: NOON });
  await enrollClient({ models, sequence: seq, clientId: cold._id, now: NOON });

  const mock = mockSenders(models);
  await tick({ models, senders: mock.senders, now: NOON, batch: 10 });

  assert.equal(mock.calls.length, 1, "only the hot lead was messaged");
  assert.equal(mock.calls[0].to, "4155550010");
});

test("stopOnReply halts the sequence when the client has replied", async (t) => {
  if (!available) return t.skip("no mongo");
  const user = await makeUser();
  const client = await makeClient(user);
  const graph = {
    nodes: [
      node("t", "client_created", "trigger"),
      node("w", "wait", "control", { value: 1, unit: "days" }),
      node("s", "send_whatsapp", "action", { body: "following up" }),
      node("e", "end", "exit"),
    ],
    edges: [edge("t", "w"), edge("w", "s"), edge("s", "e")],
  };
  const seq = await makeSeq(user, graph);
  const enr = await enrollClient({ models, sequence: seq, clientId: client._id, now: NOON });

  // client replies before the sequence advances
  await models.Message.create({
    userId: user._id, channel: "whatsapp", contactIdentifier: "4155550001",
    direction: "inbound", body: "yes interested", status: "delivered",
    timestamp: new Date(NOON.getTime() + 1000),
  });

  const mock = mockSenders(models);
  await tick({ models, senders: mock.senders, now: new Date(NOON.getTime() + 2000) });

  const after = await models.SequenceEnrollment.findById(enr._id).lean();
  assert.equal(after.status, "halted");
  assert.equal(after.haltReason, "client_replied");
  assert.equal(mock.calls.length, 0);
});

test("reply tracking: an inbound reply logs a 'replied' event once per active enrollment", async (t) => {
  if (!available) return t.skip("no mongo");
  const user = await makeUser();
  const client = await makeClient(user);
  // A sequence with NO wait_for_reply node (like Contract-to-Close) must still record replies.
  const seq = await makeSeq(user, simpleSendGraph(), { stopOnReply: false });
  const enr = await enrollClient({ models, sequence: seq, clientId: client._id, now: NOON });

  // Inbound reply lands in Messages (what the webhooks store), then the webhook wakes us.
  await models.Message.create({
    userId: user._id, channel: "gmail", contactIdentifier: client.email,
    direction: "inbound", body: "sounds good", status: "delivered", timestamp: new Date(NOON.getTime() + 1000),
  });
  const n1 = await wakeAwaitingReply(models, user._id, client.email);
  assert.equal(n1, 1, "one enrollment credited with a reply");
  assert.equal(await models.SequenceEvent.countDocuments({ enrollmentId: enr._id, type: "replied" }), 1);
  const row = await models.SequenceEnrollment.findById(enr._id).lean();
  assert.ok(row.repliedAt, "repliedAt stamped");

  // A second reply must NOT double-count (reply rate stays sane).
  const n2 = await wakeAwaitingReply(models, user._id, client.email);
  assert.equal(n2, 0, "deduped on the second reply");
  assert.equal(await models.SequenceEvent.countDocuments({ enrollmentId: enr._id, type: "replied" }), 1);
});

test("wait_for_reply: arms, then takes the replied branch when a reply arrives", async (t) => {
  if (!available) return t.skip("no mongo");
  const user = await makeUser();
  const client = await makeClient(user);
  const graph = {
    nodes: [
      node("t", "client_created", "trigger"),
      node("wfr", "wait_for_reply", "control", { timeout: { value: 2, unit: "days" } }),
      node("sr", "send_whatsapp", "action", { body: "thanks for replying" }),
      node("st", "send_whatsapp", "action", { body: "just following up" }),
      node("e1", "end", "exit"),
      node("e2", "end", "exit"),
    ],
    edges: [edge("t", "wfr"), edge("wfr", "sr", "replied"), edge("sr", "e1"), edge("wfr", "st", "timeout"), edge("st", "e2")],
  };
  // disable stopOnReply so the reply is resolved by the wait_for_reply node, not a global halt
  const seq = await makeSeq(user, graph, { stopOnReply: false });
  const enr = await enrollClient({ models, sequence: seq, clientId: client._id, now: NOON });

  const mock = mockSenders(models);
  // tick 1: arms the wait
  await tick({ models, senders: mock.senders, now: NOON });
  let mid = await models.SequenceEnrollment.findById(enr._id).lean();
  assert.equal(mid.waitContext.nodeId, "wfr", "wait armed");
  assert.equal(mock.calls.length, 0);

  // client replies; webhook wake would set nextRunAt = now
  await models.Message.create({
    userId: user._id, channel: "whatsapp", contactIdentifier: "4155550001",
    direction: "inbound", body: "yes!", status: "delivered", timestamp: new Date(NOON.getTime() + 60000),
  });
  await models.SequenceEnrollment.updateOne({ _id: enr._id }, { $set: { nextRunAt: new Date(NOON.getTime() + 61000) } });

  await tick({ models, senders: mock.senders, now: new Date(NOON.getTime() + 61000) });
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].body, "thanks for replying", "took replied branch");
});

test("wait_for_reply: takes the timeout branch when no reply by the deadline", async (t) => {
  if (!available) return t.skip("no mongo");
  const user = await makeUser();
  const client = await makeClient(user);
  const graph = {
    nodes: [
      node("t", "client_created", "trigger"),
      node("wfr", "wait_for_reply", "control", { timeout: { value: 2, unit: "days" } }),
      node("sr", "send_whatsapp", "action", { body: "thanks for replying" }),
      node("st", "send_whatsapp", "action", { body: "just following up" }),
      node("e1", "end", "exit"),
      node("e2", "end", "exit"),
    ],
    edges: [edge("t", "wfr"), edge("wfr", "sr", "replied"), edge("sr", "e1"), edge("wfr", "st", "timeout"), edge("st", "e2")],
  };
  const seq = await makeSeq(user, graph, { stopOnReply: false });
  const enr = await enrollClient({ models, sequence: seq, clientId: client._id, now: NOON });

  const mock = mockSenders(models);
  await tick({ models, senders: mock.senders, now: NOON }); // arm
  const past = new Date(NOON.getTime() + 2 * 86400000 + 1000); // after deadline
  await models.SequenceEnrollment.updateOne({ _id: enr._id }, { $set: { nextRunAt: past } });
  await tick({ models, senders: mock.senders, now: past });

  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].body, "just following up", "took timeout branch");
});

test("send failure retries with backoff, then fails the enrollment", async (t) => {
  if (!available) return t.skip("no mongo");
  const user = await makeUser();
  const client = await makeClient(user);
  const seq = await makeSeq(user, simpleSendGraph());
  const enr = await enrollClient({ models, sequence: seq, clientId: client._id, now: NOON });

  const fail = failingSenders();
  // attempt 1
  await tick({ models, senders: fail.senders, now: NOON });
  let e1 = await models.SequenceEnrollment.findById(enr._id).lean();
  assert.equal(e1.status, "active", "still retrying after attempt 1");
  assert.ok(e1.nextRunAt > NOON, "backed off");

  // attempt 2 (after first backoff)
  await tick({ models, senders: fail.senders, now: new Date(NOON.getTime() + 61000) });
  // attempt 3 → exhausts retries
  await tick({ models, senders: fail.senders, now: new Date(NOON.getTime() + 61000 + 6 * 60000) });

  const efinal = await models.SequenceEnrollment.findById(enr._id).lean();
  assert.equal(efinal.status, "failed");
  assert.equal(fail.attempts, 3, "tried MAX_SEND_RETRIES times");
});

test("dry-run logs intended sends but writes nothing and calls no provider", async (t) => {
  if (!available) return t.skip("no mongo");
  const user = await makeUser();
  const client = await makeClient(user);
  const seq = await makeSeq(user, simpleSendGraph("Hi {client.name}"));

  const { ok, log } = await dryRun({ models, sequence: seq, client, now: NOON });
  assert.equal(ok, true);
  const send = log.find((l) => l.action === "would_send");
  assert.ok(send, "log shows the intended send");
  assert.equal(send.body, "Hi Sam Lee");
  assert.equal(await models.Message.countDocuments({}), 0, "no messages written");
  assert.equal(await models.SequenceEnrollment.countDocuments({}), 0, "no enrollment created");
});

test("deal closed halts the sequence", async (t) => {
  if (!available) return t.skip("no mongo");
  const user = await makeUser();
  const client = await makeClient(user, { stage: "Closed" });
  const seq = await makeSeq(user, simpleSendGraph());
  const enr = await enrollClient({ models, sequence: seq, clientId: client._id, now: NOON });
  const mock = mockSenders(models);
  await tick({ models, senders: mock.senders, now: NOON });
  const after = await models.SequenceEnrollment.findById(enr._id).lean();
  assert.equal(after.status, "halted");
  assert.equal(after.haltReason, "deal_closed");
  assert.equal(mock.calls.length, 0);
});

test("send defers during quiet hours when the node opts in", async (t) => {
  if (!available) return t.skip("no mongo");
  const NIGHT = new Date(Date.UTC(2026, 5, 1, 23, 0, 0)); // inside the 21:00–08:00 window
  const user = await makeUser();
  const client = await makeClient(user); // no client.timezone → falls back to sequence tz (UTC)
  // Quiet hours are opt-in PER NODE; enable them on the send node so this send is held.
  const graph = simpleSendGraph();
  graph.nodes.find((n) => n.type === "send_whatsapp").config.quietHours = { enabled: true, start: "21:00", end: "08:00" };
  const seq = await makeSeq(user, graph, { timezone: "UTC" });
  const enr = await enrollClient({ models, sequence: seq, clientId: client._id, now: NIGHT });
  const mock = mockSenders(models);
  await tick({ models, senders: mock.senders, now: NIGHT });
  const after = await models.SequenceEnrollment.findById(enr._id).lean();
  assert.equal(after.status, "active", "still pending, not sent");
  assert.ok(after.nextRunAt > NIGHT, "deferred to next allowed window");
  assert.equal(mock.calls.length, 0);
});

test("send defers when the per-client daily cap is hit", async (t) => {
  if (!available) return t.skip("no mongo");
  const user = await makeUser();
  const client = await makeClient(user);
  const seq = await makeSeq(user, simpleSendGraph(), { maxPerClientPerDay: 1 });
  await models.Message.create({
    userId: user._id, channel: "whatsapp", contactIdentifier: "4155550001",
    direction: "outbound", body: "earlier today", status: "delivered", timestamp: new Date(NOON.getTime() - 3600000),
  });
  const enr = await enrollClient({ models, sequence: seq, clientId: client._id, now: NOON });
  const mock = mockSenders(models);
  await tick({ models, senders: mock.senders, now: NOON });
  const after = await models.SequenceEnrollment.findById(enr._id).lean();
  assert.equal(after.status, "active");
  assert.equal(mock.calls.length, 0, "rate cap blocked the send");
});

test("broker kill switch pauses execution", async (t) => {
  if (!available) return t.skip("no mongo");
  const user = await makeUser();
  const client = await makeClient(user);
  const seq = await makeSeq(user, simpleSendGraph());
  const enr = await enrollClient({ models, sequence: seq, clientId: client._id, now: NOON });
  await models.SequenceSettings.create({ userId: user._id, killSwitch: true });
  const mock = mockSenders(models);
  await tick({ models, senders: mock.senders, now: NOON });
  const after = await models.SequenceEnrollment.findById(enr._id).lean();
  assert.equal(after.status, "active", "not advanced while killed");
  assert.equal(mock.calls.length, 0);
});

test("editing a live sequence does not affect in-flight enrollments (version snapshot)", async (t) => {
  if (!available) return t.skip("no mongo");
  const user = await makeUser();
  const client = await makeClient(user);
  const seq = await makeSeq(user, simpleSendGraph("Hi {client.name}"));
  const enr = await enrollClient({ models, sequence: seq, clientId: client._id, now: NOON });
  await models.Sequence.updateOne({ _id: seq._id }, { $set: { graph: simpleSendGraph("EDITED BODY") } });
  const mock = mockSenders(models);
  await tick({ models, senders: mock.senders, now: NOON });
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].body, "Hi Sam Lee", "ran the enrollment's snapshot, not the edited live graph");
});
