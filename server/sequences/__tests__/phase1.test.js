import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import sequenceSchema from "../../models/Sequence.js";
import sequenceEnrollmentSchema from "../../models/SequenceEnrollment.js";
import sequenceEventSchema from "../../models/SequenceEvent.js";
import sequenceSettingsSchema from "../../models/SequenceSettings.js";
import notificationSchema from "../../models/Notification.js";
import clientSchema from "../../models/Client.js";
import messageSchema from "../../models/Message.js";

import registry from "../blocks/index.js";
import { validateGraph } from "../validator.js";
import { tick } from "../engine.js";
import { enrollOnClientCreated, enrollOnStageChanged, sweepSchedules } from "../triggers.js";
import { TEMPLATES, getTemplate, triggerOf } from "../templates.js";
import { nextScheduleTime } from "../schedule.js";

const URI = process.env.MONGODB_URI;
const noop = { skip: !URI ? "no MONGODB_URI" : false };

let conn, models, userId;

test.before(async () => {
  if (!URI) return;
  conn = await mongoose.createConnection(URI, { dbName: "EscrowsAI_seq_test_p1" }).asPromise();
  models = {
    Sequence: conn.model("Sequence", sequenceSchema),
    SequenceEnrollment: conn.model("SequenceEnrollment", sequenceEnrollmentSchema),
    SequenceEvent: conn.model("SequenceEvent", sequenceEventSchema),
    SequenceSettings: conn.model("SequenceSettings", sequenceSettingsSchema),
    Notification: conn.model("Notification", notificationSchema),
    Client: conn.model("Client", clientSchema),
    Message: conn.model("Message", messageSchema),
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

// Instantiate a template into an active Sequence (mirrors the router's create path).
async function instantiate(key, overrides = {}) {
  const t = getTemplate(key);
  const graph = JSON.parse(JSON.stringify(t.graph));
  const { triggerType, triggerConfig } = triggerOf(graph);
  return models.Sequence.create({
    userId, name: t.name, description: t.description, status: "active",
    version: 1, triggerType, triggerConfig, graph, settings: t.settings || {}, templateKey: t.key,
    ...overrides,
  });
}

test("all four templates validate against the registry", () => {
  for (const t of TEMPLATES) {
    const r = validateGraph(t.graph, registry);
    assert.equal(r.ok, true, `${t.key}: ${JSON.stringify(r.errors)}`);
  }
});

test("client_created trigger enrolls a matching client", noop, async () => {
  const seq = await instantiate("new-lead-follow-up");
  const client = await models.Client.create({ userId, name: "Ada Lovelace", email: "ada@calc.io", stage: "Lead", intent: "warm" });
  const n = await enrollOnClientCreated(models, client);
  assert.equal(n, 1);
  const enr = await models.SequenceEnrollment.findOne({ sequenceId: seq._id, clientId: client._id });
  assert.ok(enr, "enrollment created");
  assert.equal(enr.status, "active");
  // currentNode is the trigger's "out" target (notify_broker), not the trigger itself
  assert.notEqual(enr.currentNodeId, "t");
});

test("client_created respects an opted-out client", noop, async () => {
  await instantiate("new-lead-follow-up");
  const client = await models.Client.create({ userId, name: "Opt Out", email: "no@x.io", optedOut: true });
  const n = await enrollOnClientCreated(models, client);
  assert.equal(n, 0);
});

test("stage_changed only enrolls on a real transition to the target stage", noop, async () => {
  const seq = await instantiate("new-lead-follow-up", {
    triggerType: "stage_changed", triggerConfig: { toStage: "Under Contract" },
  });
  // make the seed graph's trigger a stage_changed for snapshot correctness is unnecessary —
  // enrollment uses sequence.graph; the lookup is by triggerType/triggerConfig.
  // mismatched stage → no enroll
  const c = await models.Client.create({ userId, name: "Bob", email: "bob@x.io", stage: "Engaged" });
  assert.equal(await enrollOnStageChanged(models, c, "Lead", "Engaged"), 0);
  // matching stage → enroll
  assert.equal(await enrollOnStageChanged(models, c, "Engaged", "Under Contract"), 1);
  assert.ok(await models.SequenceEnrollment.findOne({ sequenceId: seq._id, clientId: c._id }));
});

test("schedule sweep arms exactly one broker-scoped digest enrollment", noop, async () => {
  const seq = await instantiate("daily-digest");
  const now = new Date();
  const armed1 = await sweepSchedules(models, now);
  assert.equal(armed1, 1);
  // idempotent: a second sweep does not create a duplicate while one is active
  const armed2 = await sweepSchedules(models, now);
  assert.equal(armed2, 0);
  const enr = await models.SequenceEnrollment.findOne({ sequenceId: seq._id, clientId: null });
  assert.ok(enr);
  assert.equal(enr.clientId, null);
  // armed for the next 08:00 occurrence, in the future
  assert.ok(enr.nextRunAt.getTime() > now.getTime());
  assert.deepEqual(enr.nextRunAt, nextScheduleTime(now, seq.triggerConfig, "UTC"));
});

test("digest runs end-to-end and writes a Notification (the delivery sink)", noop, async () => {
  const seq = await instantiate("daily-digest");
  // seed some data for the digest to summarize
  await models.Client.create({ userId, name: "Hot1", email: "h1@x.io", intent: "hot", stage: "Lead" });
  await models.Client.create({ userId, name: "Act1", email: "a1@x.io", nextAction: "Call", stage: "Engaged" });
  // arm the digest for "now" so the tick will run it immediately
  const fireAt = new Date(Date.now() - 1000);
  await models.SequenceEnrollment.create({
    userId, sequenceId: seq._id, sequenceVersion: 1,
    graphSnapshot: JSON.parse(JSON.stringify(seq.graph)),
    clientId: null, status: "active",
    currentNodeId: seq.graph.edges.find((e) => e.source === "t").target,
    nextRunAt: fireAt, enrolledAt: fireAt,
  });

  await tick({ models, now: new Date() });

  const note = await models.Notification.findOne({ userId, source: "digest" });
  assert.ok(note, "a digest notification was written");
  assert.match(note.message, /digest/i);
  const enr = await models.SequenceEnrollment.findOne({ sequenceId: seq._id, clientId: null });
  assert.equal(enr.status, "completed");
});
