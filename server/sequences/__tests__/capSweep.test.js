import test from "node:test";
import assert from "node:assert/strict";
import { applyPlanChange, sweepActiveSequenceCaps, GRACE_MS } from "../capSweep.js";

/* ── Tiny in-memory mocks mirroring the Mongoose surface the sweep uses ── */

// A chainable .find() result supporting .select().sort().lean().
function chain(rows) {
  const obj = {
    _rows: rows.slice(),
    select() { return obj; },
    sort(spec) {
      const keys = Object.keys(spec);
      obj._rows.sort((a, b) => {
        for (const k of keys) {
          const dir = spec[k];
          const av = a[k] ? new Date(a[k]).getTime() : 0;
          const bv = b[k] ? new Date(b[k]).getTime() : 0;
          if (av !== bv) return (av - bv) * dir;
        }
        return 0;
      });
      return obj;
    },
    lean() { return Promise.resolve(obj._rows); },
  };
  return obj;
}

function makeUserModel(users) {
  return {
    find(q) {
      const rows = users.filter((u) => {
        if (q.planGraceUntil && q.planGraceUntil.$ne === null) {
          return u.planGraceUntil != null && u.planGraceUntil <= q.planGraceUntil.$lte;
        }
        return true;
      });
      return chain(rows);
    },
    async updateOne(q, upd) {
      const u = users.find((x) => String(x._id) === String(q._id));
      if (u) Object.assign(u, upd.$set);
    },
  };
}

function makeSequenceModel(seqs) {
  return {
    async countDocuments(q) {
      return seqs.filter((s) => String(s.userId) === String(q.userId) && s.status === q.status).length;
    },
    find(q) {
      const rows = seqs.filter((s) => String(s.userId) === String(q.userId) && s.status === q.status);
      return chain(rows);
    },
    async updateMany(q, upd) {
      const ids = q._id.$in.map(String);
      for (const s of seqs) if (ids.includes(String(s._id))) Object.assign(s, upd.$set);
    },
  };
}

function makeCreditModel(accounts) {
  return {
    async findOne(q) {
      return accounts.find((a) => String(a.userId) === String(q.userId)) || null;
    },
    async updateOne(q, upd) {
      const a = accounts.find((x) => String(x.userId) === String(q.userId));
      if (!a) return;
      if (upd.$set) Object.assign(a, upd.$set);
      if (upd.$inc) for (const [k, v] of Object.entries(upd.$inc)) a[k] = (a[k] || 0) + v;
    },
    async create(doc) {
      accounts.push({ ...doc });
      return doc;
    },
  };
}

test("applyPlanChange opens a grace window only when over the new cap", async () => {
  const users = [{ _id: "u1", plan: "pro", planGraceUntil: null }];
  // 5 active under a downgrade to free (cap 2) → over.
  const seqs = Array.from({ length: 5 }, (_, i) => ({ _id: "s" + i, userId: "u1", status: "active" }));
  const r = await applyPlanChange({ User: makeUserModel(users), Sequence: makeSequenceModel(seqs) }, "u1", "free");
  assert.equal(r.over, true);
  assert.equal(r.limit, 2);
  assert.equal(users[0].plan, "free");
  assert.ok(users[0].planGraceUntil instanceof Date);
});

test("applyPlanChange clears grace when at/under the new cap", async () => {
  const users = [{ _id: "u1", plan: "pro", planGraceUntil: new Date() }];
  const seqs = [{ _id: "s0", userId: "u1", status: "active" }]; // 1 active, free cap 2 → fine
  const r = await applyPlanChange({ User: makeUserModel(users), Sequence: makeSequenceModel(seqs) }, "u1", "free");
  assert.equal(r.over, false);
  assert.equal(users[0].planGraceUntil, null);
});

test("applyPlanChange UPGRADE grants the credit increase and syncs tier + status meta", async () => {
  const users = [{ _id: "u1", plan: "free", planGraceUntil: null }];
  const seqs = []; // no active sequences → never over cap
  const accts = [{ userId: "u1", tier: "free", monthlyAllocation: 40, credits: 10 }]; // spent down to 10
  const r = await applyPlanChange(
    { User: makeUserModel(users), Sequence: makeSequenceModel(seqs), CreditAccount: makeCreditModel(accts) },
    "u1",
    "pro",
    { planInterval: "month", subscriptionStatus: "active", planRenewsAt: new Date("2026-07-25"), cancelAtPeriodEnd: false },
  );
  assert.equal(r.creditGrant, 660); // 700 - 40
  assert.equal(accts[0].tier, "pro");
  assert.equal(accts[0].monthlyAllocation, 700);
  assert.equal(accts[0].credits, 670); // 10 balance + 660 grant
  assert.equal(accts[0].unlimited, false);
  assert.equal(users[0].planInterval, "month");
  assert.equal(users[0].subscriptionStatus, "active");
  assert.equal(users[0].cancelAtPeriodEnd, false);
});

test("applyPlanChange DOWNGRADE keeps current credit balance, lowers future allocation", async () => {
  const users = [{ _id: "u1", plan: "pro", planGraceUntil: null }];
  const seqs = []; // under cap
  const accts = [{ userId: "u1", tier: "pro", monthlyAllocation: 700, credits: 500 }];
  const r = await applyPlanChange(
    { User: makeUserModel(users), Sequence: makeSequenceModel(seqs), CreditAccount: makeCreditModel(accts) },
    "u1",
    "growth",
  );
  assert.equal(r.creditGrant, 0); // no top-up on downgrade
  assert.equal(accts[0].tier, "growth");
  assert.equal(accts[0].monthlyAllocation, 250);
  assert.equal(accts[0].credits, 500); // balance untouched
});

test("applyPlanChange seeds a CreditAccount when the user has none", async () => {
  const users = [{ _id: "u1", plan: "free", planGraceUntil: null }];
  const accts = [];
  await applyPlanChange(
    { User: makeUserModel(users), Sequence: makeSequenceModel([]), CreditAccount: makeCreditModel(accts) },
    "u1",
    "growth",
  );
  assert.equal(accts.length, 1);
  assert.equal(accts[0].tier, "growth");
  assert.equal(accts[0].credits, 250);
});

test("sweep pauses the excess, keeping the most-recently-activated, and clears grace", async () => {
  const past = new Date(Date.now() - 1000);
  const users = [{ _id: "u1", plan: "free", planGraceUntil: past }];
  // 4 active; free cap 2 → pause the 2 oldest, keep the 2 newest.
  const seqs = [
    { _id: "old1", userId: "u1", status: "active", name: "Oldest", activatedAt: new Date("2026-01-01") },
    { _id: "old2", userId: "u1", status: "active", name: "Older", activatedAt: new Date("2026-02-01") },
    { _id: "new1", userId: "u1", status: "active", name: "Newer", activatedAt: new Date("2026-05-01") },
    { _id: "new2", userId: "u1", status: "active", name: "Newest", activatedAt: new Date("2026-06-01") },
  ];
  const notes = [];
  const Notification = { async create(doc) { notes.push(doc); } };
  const results = await sweepActiveSequenceCaps({
    User: makeUserModel(users), Sequence: makeSequenceModel(seqs), Notification,
  });

  const status = Object.fromEntries(seqs.map((s) => [s._id, s.status]));
  assert.equal(status.new1, "active");
  assert.equal(status.new2, "active");
  assert.equal(status.old1, "paused");
  assert.equal(status.old2, "paused");
  assert.equal(results[0].pausedCount, 2);
  assert.equal(users[0].planGraceUntil, null); // cleared → enforced once
  assert.equal(notes.length, 1);
  assert.equal(notes[0].priority, "high");
});

test("sweep ignores users whose grace deadline hasn't passed", async () => {
  const future = new Date(Date.now() + GRACE_MS);
  const users = [{ _id: "u1", plan: "free", planGraceUntil: future }];
  const seqs = Array.from({ length: 4 }, (_, i) => ({ _id: "s" + i, userId: "u1", status: "active", activatedAt: new Date() }));
  const results = await sweepActiveSequenceCaps({ User: makeUserModel(users), Sequence: makeSequenceModel(seqs), Notification: null });
  assert.equal(results.length, 0);
  assert.ok(seqs.every((s) => s.status === "active")); // untouched
});
