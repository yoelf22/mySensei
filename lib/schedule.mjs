// Decide whether a lesson is due right now, in the learner's own timezone.
// The GitHub Action fires hourly; this gate makes the *effective* cadence the
// user's choice (day/week, local time, workweek days) without rewriting cron.

/** Local parts (weekday 0=Sun..6=Sat, hour 0-23) for `now` in `timezone`. */
export function localParts(timezone, now) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  );
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0; // some engines render midnight as "24"
  return { weekday: weekdayMap[parts.weekday], hour };
}

/**
 * Should the cadence job send a lesson at `now`?
 * - daily: on any workweek day, at the delivery hour.
 * - weekly: only on the FIRST workweek day, at the delivery hour.
 */
export function shouldSendNow(settings, now) {
  const days = (settings.workweekDays && settings.workweekDays.length
    ? settings.workweekDays
    : [0, 1, 2, 3, 4, 5, 6]).slice().sort((a, b) => a - b);
  const deliveryHour = parseInt(String(settings.deliveryTime || "07:00").split(":")[0], 10);
  const { weekday, hour } = localParts(settings.timezone || "UTC", now);

  if (hour !== deliveryHour) return false;
  if (!days.includes(weekday)) return false;
  if (settings.cadence === "weekly") return weekday === days[0];
  return true; // daily
}
