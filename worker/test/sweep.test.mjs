import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../src/worker.mjs";
import { dueCourseIds, runSweep } from "../src/sweep.mjs";
import { createCourse, saveCurriculum } from "../src/db.mjs";

const E = { ...env, GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r" };
const dailyAt = (hh) => ({ cadence: "daily", deliveryTime: `${String(hh).padStart(2, "0")}:00`, timezone: "UTC", workweekDays: [0,1,2,3,4,5,6] });
const NOON_UTC = new Date("2026-06-22T12:00:00Z");

beforeEach(() => { globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })); });

describe("dueCourseIds", () => {
  it("keeps only courses due at this hour", () => {
    const courses = [
      { id: "due1", settings: dailyAt(12) },
      { id: "not1", settings: dailyAt(13) },
    ];
    expect(dueCourseIds(courses, NOON_UTC)).toEqual(["due1"]);
  });
});

describe("runSweep + scheduled", () => {
  beforeEach(async () => { await env.DB.exec("DELETE FROM courses;"); });

  it("dispatches lesson-due only for due active courses", async () => {
    const due = await createCourse(env, "me@x.com");
    const notDue = await createCourse(env, "me@x.com");
    const paused = await createCourse(env, "me@x.com");
    await saveCurriculum(env, due.id, { settings: dailyAt(12), progress: { status: "active" } });
    await saveCurriculum(env, notDue.id, { settings: dailyAt(13), progress: { status: "active" } });
    await saveCurriculum(env, paused.id, { settings: dailyAt(12), progress: { status: "paused" } });

    const res = await runSweep(E, NOON_UTC);
    expect(res.dispatched).toEqual([due.id]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.event_type).toBe("lesson-due");
    expect(body.client_payload.courseId).toBe(due.id);
  });

  it("scheduled() runs the sweep", async () => {
    const due = await createCourse(env, "me@x.com");
    await saveCurriculum(env, due.id, { settings: dailyAt(12), progress: { status: "active" } });
    const ctx = createExecutionContext();
    await worker.scheduled({ scheduledTime: NOON_UTC.getTime(), cron: "0 * * * *" }, E, ctx);
    await waitOnExecutionContext(ctx);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
