/**
 * Engine-wide tunables. Defaults chosen for the "can't be fucked up" bar:
 * conservative caps, short locks, generous catch-up. Overridable via env.
 */

const num = (v, d) => (v == null || v === "" || Number.isNaN(Number(v)) ? d : Number(v));

export const TICK_MS = num(process.env.SEQUENCES_TICK_MS, 60_000); // engine heartbeat
export const LOCK_TTL_MS = num(process.env.SEQUENCES_LOCK_TTL_MS, 120_000); // claim lock lifetime
export const BATCH_SIZE = num(process.env.SEQUENCES_BATCH_SIZE, 50); // enrollments per tick
export const HOP_CAP = num(process.env.SEQUENCES_HOP_CAP, 25); // immediate (0-delay) hops per process pass
export const MAX_STEPS_PER_ENROLLMENT = num(process.env.SEQUENCES_MAX_STEPS, 200); // absolute lifetime cap

export const MAX_SEND_RETRIES = num(process.env.SEQUENCES_MAX_RETRIES, 3);
// backoff per attempt index (0-based); falls back to last value
export const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];

export const DEFAULTS = {
  timezone: process.env.SEQUENCES_DEFAULT_TZ || "UTC",
  // Quiet hours are OFF by default and configured per send node (send_email / send_whatsapp).
  // When a node opts in, its window is evaluated in the CLIENT's timezone (the person being
  // notified) — correct for international clients, and it mainly matters for WhatsApp, which
  // pings the phone immediately, plus messaging-compliance windows.
  mode: "auto", // "auto" | "approval"
  stopOnReply: true,
  stopOnClosed: true,
  maxPerClientPerDay: num(process.env.SEQUENCES_MAX_PER_CLIENT_PER_DAY, 5),
  maxStepsPerEnrollment: MAX_STEPS_PER_ENROLLMENT,
};

export const WAIT_FOR_REPLY_DEFAULT_TIMEOUT = { value: 3, unit: "days" };

// Convert a { value, unit } delay into milliseconds.
export function durationToMs({ value, unit }) {
  const v = Number(value) || 0;
  switch (unit) {
    case "minutes": return v * 60_000;
    case "hours": return v * 3_600_000;
    case "days": return v * 86_400_000;
    default: return v; // assume already ms
  }
}

export function backoffMs(attemptIndex) {
  return RETRY_BACKOFF_MS[Math.min(attemptIndex, RETRY_BACKOFF_MS.length - 1)];
}

// Global kill switch — halts ALL execution instantly when set.
export function globalKillEngaged() {
  return process.env.SEQUENCES_GLOBAL_KILL === "1";
}
