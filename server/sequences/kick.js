/**
 * A tiny, dependency-free bridge so trigger/enroll code can ask the scheduler to run a
 * tick "soon" without waiting for the next heartbeat. The scheduler registers a kicker on
 * startup; callers fire requestKick() right after an enrollment is created so the first
 * step goes out within a second instead of up to TICK_MS later.
 *
 * Lives in its own module to avoid a circular import (engine ⇄ scheduler).
 */
let kicker = null;

export function setKicker(fn) {
  kicker = typeof fn === "function" ? fn : null;
}

export function requestKick() {
  try {
    kicker?.();
  } catch {
    /* a missed kick just means the next heartbeat handles it — never throw */
  }
}
