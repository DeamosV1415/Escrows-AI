import test from "node:test";
import assert from "node:assert/strict";
import { quietHoursDefer } from "../guards.js";

const settings = { timezone: "UTC", quietHours: { start: "21:00", end: "08:00" } };

test("quietHoursDefer returns a defer time inside the quiet window", () => {
  const now = new Date(Date.UTC(2026, 0, 1, 23, 0, 0)); // 23:00 UTC — inside 21:00–08:00
  const defer = quietHoursDefer(now, settings);
  assert.ok(defer instanceof Date);
  // next allowed = 08:00 next day = 9h later
  assert.equal(Math.round((defer - now) / 60000), 9 * 60);
});

test("quietHoursDefer returns null outside the quiet window", () => {
  const now = new Date(Date.UTC(2026, 0, 1, 12, 0, 0)); // noon UTC — allowed
  assert.equal(quietHoursDefer(now, settings), null);
});

test("quiet hours just after midnight still defers to 08:00", () => {
  const now = new Date(Date.UTC(2026, 0, 1, 2, 0, 0)); // 02:00 UTC
  const defer = quietHoursDefer(now, settings);
  assert.ok(defer instanceof Date);
  assert.equal(Math.round((defer - now) / 60000), 6 * 60);
});

test("equal start/end disables quiet hours", () => {
  const now = new Date(Date.UTC(2026, 0, 1, 23, 0, 0));
  assert.equal(quietHoursDefer(now, { timezone: "UTC", quietHours: { start: "00:00", end: "00:00" } }), null);
});
