// worker/test/db.test.mjs
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { isAllowlisted, createCourse, listCourses, getCourse, setStatus, countActive } from "../src/db.mjs";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM allowlist; DELETE FROM courses;");
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
