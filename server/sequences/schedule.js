/**
 * Timezone-aware "next fire time" math for the `schedule` trigger (the broker digest).
 * No external date library: we use the standard Intl offset trick to map a wall-clock
 * time in a given IANA timezone to a real UTC instant.
 */

// The wall-clock parts (Y-M-D-H-M and weekday) of an instant, as seen in `tz`.
function partsInTz(date, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const map = {};
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
  const weekdayIdx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[map.weekday];
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
    minute: Number(map.minute),
    weekday: weekdayIdx,
  };
}

// The UTC instant for a given wall-clock Y-M-D H:M in `tz`.
function instantFromZoned(year, month, day, hour, minute, tz) {
  const guessMs = Date.UTC(year, month - 1, day, hour, minute);
  // Offset = (how that guessed UTC instant reads in tz) - (the wall clock we wanted).
  const seen = partsInTz(new Date(guessMs), tz);
  const seenMs = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  const offset = seenMs - guessMs;
  return new Date(guessMs - offset);
}

/**
 * Next instant strictly after `now` matching a schedule config:
 *   { frequency: "daily"|"weekly", time: "HH:MM", weekday?: 0-6, tz?: string }
 */
export function nextScheduleTime(now, cfg, fallbackTz = "UTC") {
  const tz = cfg.tz || fallbackTz || "UTC";
  const [hh, mm] = String(cfg.time || "08:00").split(":").map(Number);
  const today = partsInTz(now, tz);

  for (let i = 0; i < 8; i++) {
    // i days forward from "today" in tz, at HH:MM.
    const base = new Date(Date.UTC(today.year, today.month - 1, today.day + i, 12, 0));
    const p = partsInTz(base, tz);
    const candidate = instantFromZoned(p.year, p.month, p.day, hh, mm, tz);
    if (candidate.getTime() <= now.getTime()) continue;
    if (cfg.frequency === "weekly") {
      const wd = partsInTz(candidate, tz).weekday;
      if (wd !== (cfg.weekday ?? 1)) continue;
    }
    return candidate;
  }
  // Fallback: 24h out (should never hit).
  return new Date(now.getTime() + 86_400_000);
}
