// worker/test/db.test.mjs
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { isAllowlisted, createCourse, listCourses, getCourse, setStatus, countActive, listActiveCourses, addToAllowlist, listAllowlist, removeFromAllowlist, setLastError, countInvitesBy, createShare, getShare, claimShareUse, adminStats } from "../src/db.mjs";
import { courseToCurriculum, saveCurriculum, getPage, putPage } from "../src/db.mjs";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM allowlist; DELETE FROM courses; DELETE FROM pages;");
});

describe("db", () => {
  it("allowlist check is case-insensitive", async () => {
    await env.DB.prepare("INSERT INTO allowlist(email, added_at) VALUES('me@x.com','t')").run();
    expect(await isAllowlisted(env, "ME@X.com")).toBe(true);
    expect(await isAllowlisted(env, "no@x.com")).toBe(false);
  });
  it("create/list/get a course", async () => {
    const { id } = await createCourse(env, "me@x.com");
    const got = await getCourse(env, id);
    expect(got.owner_email).toBe("me@x.com");
    expect(got.status).toBe("draft");
    const list = await listCourses(env, "me@x.com");
    expect(list.map((c) => c.id)).toContain(id);
  });
  it("countActive counts only active courses", async () => {
    const a = await createCourse(env, "me@x.com");
    const b = await createCourse(env, "me@x.com");
    await setStatus(env, a.id, "active");
    await setStatus(env, b.id, "active");
    expect(await countActive(env, "me@x.com")).toBe(2);
  });
});

describe("curriculum mapping + pages", () => {
  it("round-trips a curriculum object through the columns", async () => {
    const { id } = await createCourse(env, "me@x.com");
    const c = {
      version: 1, subject: "Taxes", angle: "progressive", startLevel: 6, level: 6,
      settings: { language: "Hebrew", languageCode: "he", chunkMinutes: 10, passThreshold: 0.7 },
      researchContext: "ground", assessment: { questions: [{ q: "a" }] }, placement: { rationale: "mid" },
      outline: [{ id: 1, title: "M1", targetLevel: 7 }],
      progress: { currentModule: 1, attempt: 1, status: "active", delivered: [], lastQuiz: null },
      trackHistory: [],
    };
    await saveCurriculum(env, id, c);
    const back = courseToCurriculum(await rawRow(env, id));
    expect(back.subject).toBe("Taxes");
    expect(back.startLevel).toBe(6);
    expect(back.settings.languageCode).toBe("he");
    expect(back.researchContext).toBe("ground");
    expect(back.assessment.questions[0].q).toBe("a");
    expect(back.placement.rationale).toBe("mid");
    expect(back.outline[0].targetLevel).toBe(7);
    expect(back.progress.currentModule).toBe(1);
    expect(back.version).toBe(1);
    expect(back.trackHistory).toEqual([]);
  });

  it("saveCurriculum sets the status column from progress.status (drives the dashboard + cap)", async () => {
    const { id } = await createCourse(env, "me@x.com");
    await saveCurriculum(env, id, { progress: { status: "awaiting-approval" } });
    const row = await getCourse(env, id);
    expect(row.status).toBe("awaiting-approval");
  });

  it("putPage upserts and getPage reads back the latest html", async () => {
    const { id } = await createCourse(env, "me@x.com");
    expect(await getPage(env, id, "assessment")).toBe(null);
    await putPage(env, id, "assessment", "<h1>one</h1>");
    await putPage(env, id, "assessment", "<h1>two</h1>");
    expect(await getPage(env, id, "assessment")).toBe("<h1>two</h1>");
  });
});

describe("syllabus front-matter column", () => {
  it("round-trips curriculum.syllabus through the new column", async () => {
    const { id } = await createCourse(env, "me@x.com");
    await saveCurriculum(env, id, {
      progress: { status: "active" },
      syllabus: { title: "T", subtitle: "Sub", introduction: "Intro" },
    });
    const back = courseToCurriculum(await rawRow(env, id));
    expect(back.syllabus.title).toBe("T");
    expect(back.syllabus.subtitle).toBe("Sub");
    expect(back.syllabus.introduction).toBe("Intro");
  });
});

describe("listActiveCourses", () => {
  it("returns only active courses with parsed settings", async () => {
    const a = await createCourse(env, "me@x.com");
    const b = await createCourse(env, "me@x.com");
    await saveCurriculum(env, a.id, { settings: { cadence: "daily" }, progress: { status: "active" } });
    await saveCurriculum(env, b.id, { settings: { cadence: "weekly" }, progress: { status: "paused" } });
    const active = await listActiveCourses(env);
    const ids = active.map((c) => c.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
    expect(active.find((c) => c.id === a.id).settings.cadence).toBe("daily");
  });
});

describe("allowlist management", () => {
  it("add (case-insensitive, idempotent), list, remove", async () => {
    await addToAllowlist(env, "A@X.com");
    await addToAllowlist(env, "a@x.com"); // same lowercased — idempotent
    expect(await listAllowlist(env)).toContain("a@x.com");
    await removeFromAllowlist(env, "A@X.COM");
    expect(await listAllowlist(env)).not.toContain("a@x.com");
  });
});

describe("last_error", () => {
  it("setLastError sets it; saveCurriculum clears it on the next save", async () => {
    const { id } = await createCourse(env, "me@x.com");
    await setLastError(env, id, "boom");
    expect((await getCourse(env, id)).last_error).toBe("boom");
    await saveCurriculum(env, id, { progress: { status: "active" } });
    expect((await getCourse(env, id)).last_error).toBe(null);
  });
});

describe("invite quota tracking", () => {
  beforeEach(async () => { await env.DB.exec("DELETE FROM allowlist;"); });

  it("addToAllowlist reports a fresh insert and records the inviter", async () => {
    const r = await addToAllowlist(env, "Friend@Y.com", "Me@X.com");
    expect(r.inserted).toBe(true);
    expect(await listAllowlist(env)).toContain("friend@y.com");
    expect(await countInvitesBy(env, "me@x.com")).toBe(1);
  });

  it("addToAllowlist on an existing email is not a fresh insert", async () => {
    await addToAllowlist(env, "dup@y.com", "me@x.com");
    const again = await addToAllowlist(env, "dup@y.com", "someone-else@x.com");
    expect(again.inserted).toBe(false);
    // the inviter is not overwritten, and no second invite is counted
    expect(await countInvitesBy(env, "me@x.com")).toBe(1);
    expect(await countInvitesBy(env, "someone-else@x.com")).toBe(0);
  });

  it("addToAllowlist without an inviter stores NULL and counts for no one", async () => {
    const r = await addToAllowlist(env, "seed@y.com");
    expect(r.inserted).toBe(true);
    expect(await countInvitesBy(env, "")).toBe(0);
  });

  it("countInvitesBy counts only that user's invited rows", async () => {
    await addToAllowlist(env, "a@y.com", "me@x.com");
    await addToAllowlist(env, "b@y.com", "me@x.com");
    await addToAllowlist(env, "c@y.com", "other@x.com");
    expect(await countInvitesBy(env, "me@x.com")).toBe(2);
    expect(await countInvitesBy(env, "other@x.com")).toBe(1);
  });
});

describe("course sharing db", () => {
  beforeEach(async () => { await env.DB.exec("DELETE FROM shares; DELETE FROM courses;"); });

  it("createShare + getShare round-trip", async () => {
    const { token } = await createShare(env, { subject: "Chess", angle: "for clubs", createdBy: "Me@X.com" });
    const row = await getShare(env, token);
    expect(row.subject).toBe("Chess");
    expect(row.angle).toBe("for clubs");
    expect(row.max_uses).toBe(10);
    expect(row.uses).toBe(0);
    expect(row.created_by).toBe("me@x.com");
  });

  it("claimShareUse is atomic and stops at max_uses", async () => {
    const { token } = await createShare(env, { subject: "X", angle: "", createdBy: "a@x.com", maxUses: 2 });
    expect(await claimShareUse(env, token)).toBe(true);
    expect(await claimShareUse(env, token)).toBe(true);
    expect(await claimShareUse(env, token)).toBe(false);
    expect((await getShare(env, token)).uses).toBe(2);
    expect(await claimShareUse(env, "nope")).toBe(false);
  });

  it("createCourse can preset subject + angle", async () => {
    const { id } = await createCourse(env, "u@x.com", "Chess", "for clubs");
    const c = await getCourse(env, id);
    expect(c.subject).toBe("Chess");
    expect(c.angle).toBe("for clubs");
    expect(c.status).toBe("draft");
    const bare = await getCourse(env, (await createCourse(env, "u@x.com")).id);
    expect(bare.subject == null || bare.subject === "").toBe(true);
  });
});

describe("adminStats", () => {
  async function seed(id, subject, status, createdAt) {
    await env.DB.prepare(
      "INSERT INTO courses(id, owner_email, status, subject, created_at, updated_at) VALUES(?,?,?,?,?,?)",
    ).bind(id, "u@x.com", status, subject, createdAt, createdAt).run();
  }
  beforeEach(async () => { await env.DB.exec("DELETE FROM courses;"); });

  it("cumulative series, excludes empty-subject drafts, tallies status, no emails", async () => {
    await seed("a1", "Chess", "active", "2026-06-01T10:00:00Z");
    await seed("a2", "Go", "paused", "2026-06-01T12:00:00Z");
    await seed("a3", "Tea", "done", "2026-06-03T09:00:00Z");
    await seed("a4", "", "draft", "2026-06-04T09:00:00Z"); // empty subject → excluded
    const s = await adminStats(env);
    expect(s.summary).toEqual({ started: 3, active: 1, paused: 1, done: 1 });
    expect(s.series).toEqual([{ date: "2026-06-01", total: 2 }, { date: "2026-06-03", total: 3 }]);
    expect(s.courses.length).toBe(3);
    expect(JSON.stringify(s)).not.toMatch(/@/); // never leaks an email
  });

  it("returns empty shapes when there are no started courses", async () => {
    const s = await adminStats(env);
    expect(s.courses).toEqual([]);
    expect(s.series).toEqual([]);
    expect(s.summary).toEqual({ started: 0, active: 0, paused: 0, done: 0 });
  });
});

// helper: read the raw row (columns un-parsed) for mapping tests
async function rawRow(env, id) {
  return env.DB.prepare("SELECT * FROM courses WHERE id = ?").bind(id).first();
}
