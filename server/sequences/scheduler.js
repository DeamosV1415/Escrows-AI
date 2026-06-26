import { tick } from "./engine.js";
import { TICK_MS } from "./constants.js";
import { setKicker } from "./kick.js";
import { sweepActiveSequenceCaps } from "./capSweep.js";

/**
 * The in-process heartbeat. Primary clock for the engine; a guard ensures only one tick
 * runs at a time. cronjob.org can additionally hit POST /api/sequences/tick as a backup.
 */
let running = false;
let timer = null;
let kickQueued = false;

// Plan-cap sweep rides the heartbeat but only needs to run occasionally — it just
// enforces downgrade grace deadlines. Rate-limited to hourly so a fast tick interval
// doesn't hammer it.
const CAP_SWEEP_MS = 60 * 60 * 1000;
let lastCapSweep = 0;

export function startScheduler(models) {
  if (process.env.SEQUENCES_SCHEDULER_DISABLED === "1") return null;
  if (timer) return timer;

  const run = async () => {
    if (running) return; // never overlap ticks in-process
    running = true;
    try {
      await tick({ models });
      if (Date.now() - lastCapSweep >= CAP_SWEEP_MS) {
        lastCapSweep = Date.now();
        try {
          await sweepActiveSequenceCaps(models);
        } catch (e) {
          console.error("⚠️ Active-sequence cap sweep error:", e?.message);
        }
      }
    } catch (e) {
      console.error("⚠️ Sequence tick error:", e?.message);
    } finally {
      running = false;
    }
  };

  // Run a tick "soon" after an enrollment is created, so the first step fires within ~1s
  // instead of waiting up to a full TICK_MS. Atomic claims make the extra pass safe.
  setKicker(() => {
    if (running || kickQueued) return;
    kickQueued = true;
    setTimeout(() => {
      kickQueued = false;
      run();
    }, 50);
  });

  timer = setInterval(run, TICK_MS);
  if (timer.unref) timer.unref(); // don't keep the process alive on its own
  console.log(`⏱️  Sequence scheduler started (every ${TICK_MS}ms)`);
  return timer;
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
