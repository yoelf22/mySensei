import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/worker.mjs";
import { createCourse, putPage, saveCurriculum } from "../src/db.mjs";

const E = { ...env, APP_BASE_URL: "https://app.example" };
async function get(path) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://app" + path), E, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
beforeEach(async () => { await env.DB.exec("DELETE FROM courses; DELETE FROM pages;"); });

describe("serve /c/:id/<slug>", () => {
  it("renders the onboard form live with courseId + submit URL", async () => {
    const { id } = await createCourse(env, "me@x.com");
    const res = await get(`/c/${id}/onboard`);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain(id);                       // courseId embedded
    expect(body).toContain("app.example/submit");     // posts to the submit URL
  });

  it("404s onboard for an unknown course", async () => {
    expect((await get(`/c/zzzznope1234/onboard`)).status).toBe(404);
  });

  it("serves a stored page and 404s an absent one", async () => {
    const { id } = await createCourse(env, "me@x.com");
    await putPage(env, id, "assessment", "<h1>placement</h1>");
    const ok = await get(`/c/${id}/assessment`);
    expect(ok.headers.get("Content-Type")).toContain("text/html");
    expect(await ok.text()).toContain("placement");
    expect((await get(`/c/${id}/lesson-99-attempt9`)).status).toBe(404);
  });
});

describe("course contents page /c/:id", () => {
  it("lists the syllabus and every delivered class", async () => {
    const { id } = await createCourse(env, "me@x.com");
    await saveCurriculum(env, id, {
      subject: "S",
      settings: { languageCode: "en" },
      outline: [{ id: 1, title: "Module One" }],
      progress: { status: "active", delivered: [{ module: 1, attempt: 1, lessonFile: "lesson-01-attempt1", sentAt: "2026-06-21" }] },
    });
    const res = await get(`/c/${id}`);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain(`/c/${id}/syllabus`);
    expect(body).toContain(`/c/${id}/lesson-01-attempt1`);
    expect(body).toContain("Module One");
  });

  it("404s the contents page for an unknown course", async () => {
    expect((await get(`/c/zzzznope1234`)).status).toBe(404);
  });
});
