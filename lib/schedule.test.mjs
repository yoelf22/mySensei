import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldSendNow, localParts } from "./schedule.mjs";

// 2026-06-21 is a Sunday. 04:00 UTC = 07:00 Asia/Jerusalem (UTC+3 in summer).
const sun07Jerusalem = new Date("2026-06-21T04:00:00Z");
const sun08Jerusalem = new Date("2026-06-21T05:00:00Z");
const fri07Jerusalem = new Date("2026-06-19T04:00:00Z"); // Friday (off-day in IL)

const daily = {
  cadence: "daily",
  deliveryTime: "07:00",
  timezone: "Asia/Jerusalem",
  workweekDays: [0, 1, 2, 3, 4], // Sun-Thu
};

test("localParts converts UTC to the timezone's weekday + hour", () => {
  const p = localParts("Asia/Jerusalem", sun07Jerusalem);
  assert.equal(p.weekday, 0); // Sunday
  assert.equal(p.hour, 7);
});

test("daily: sends at the delivery hour on a workweek day", () => {
  assert.equal(shouldSendNow(daily, sun07Jerusalem), true);
});

test("daily: silent at other hours", () => {
  assert.equal(shouldSendNow(daily, sun08Jerusalem), false);
});

test("daily: silent on an off-day (Friday)", () => {
  assert.equal(shouldSendNow(daily, fri07Jerusalem), false);
});

test("weekly: only fires on the first workweek day", () => {
  const weekly = { ...daily, cadence: "weekly" };
  assert.equal(shouldSendNow(weekly, sun07Jerusalem), true); // Sunday = first day
  // Monday 07:00 local = 2026-06-22T04:00:00Z
  assert.equal(shouldSendNow(weekly, new Date("2026-06-22T04:00:00Z")), false);
});
