import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/worker.mjs";
import { createCourse, putPage } from "../src/db.mjs";

beforeEach(async () => { await env.DB.exec("DELETE FROM courses; DELETE FROM pages;"); });

it("serves a stored project page", async () => {
  const { id } = await createCourse(env, "me@x.com", "T", "", "research");
  await putPage(env, id, "project", "<h1>Your research plan</h1>");
  const res = await worker.fetch(new Request("https://w.test/c/" + id + "/project"), env);
  expect(res.status).toBe(200);
  expect(await res.text()).toMatch(/Your research plan/);
});
