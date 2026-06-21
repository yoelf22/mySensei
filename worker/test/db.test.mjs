// worker/test/db.test.mjs
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { isAllowlisted, createCourse, listCourses, getCourse, setStatus, countActive } from "../src/db.mjs";
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

// helper: read the raw row (columns un-parsed) for mapping tests
async function rawRow(env, id) {
  return env.DB.prepare("SELECT * FROM courses WHERE id = ?").bind(id).first();
}
