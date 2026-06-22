import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/worker.mjs";
import { createCourse, getCourse } from "../src/db.mjs";

const TOKEN = "tok-123";
const E = { ...env, INTERNAL_TOKEN: TOKEN };
async function call(path, init) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://app" + path, init), E, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const auth = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" };

beforeEach(async () => { await env.DB.exec("DELETE FROM courses; DELETE FROM pages;"); });

describe("internal API", () => {
  it("rejects a missing/bad token with 401", async () => {
    const { id } = await createCourse(env, "me@x.com");
    expect((await call(`/internal/course/${id}`, {})).status).toBe(401);
    expect((await call(`/internal/course/${id}`, { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("GET returns the curriculum object; 404 when unknown", async () => {
    const { id } = await createCourse(env, "me@x.com");
    const res = await call(`/internal/course/${id}`, { headers: auth });
    expect(res.status).toBe(200);
    const c = await res.json();
    expect(c.version).toBe(1);
    expect(c.progress.status).toBe("draft");
    expect((await call(`/internal/course/zzzznope1234`, { headers: auth })).status).toBe(404);
  });

  it("PUT course persists, PUT page stores html", async () => {
    const { id } = await createCourse(env, "me@x.com");
    const put = await call(`/internal/course/${id}`, {
      method: "PUT", headers: auth,
      body: JSON.stringify({ subject: "Taxes", level: 6, progress: { status: "active", currentModule: 1 } }),
    });
    expect(put.status).toBe(200);
    const back = await (await call(`/internal/course/${id}`, { headers: auth })).json();
    expect(back.subject).toBe("Taxes");
    expect(back.progress.status).toBe("active");

    const page = await call(`/internal/course/${id}/page`, {
      method: "PUT", headers: auth, body: JSON.stringify({ path: "assessment", html: "<h1>hi</h1>" }),
    });
    expect(page.status).toBe(200);
  });

  it("PUT /internal/course/:id/error sets last_error", async () => {
    const { id } = await createCourse(env, "me@x.com");
    const res = await call(`/internal/course/${id}/error`, { method: "PUT", headers: auth, body: JSON.stringify({ error: "boom" }) });
    expect(res.status).toBe(200);
    expect((await getCourse(env, id)).last_error).toBe("boom");
  });
  it("rejects /error without the bearer token", async () => {
    const { id } = await createCourse(env, "me@x.com");
    expect((await call(`/internal/course/${id}/error`, { method: "PUT", body: "{}" })).status).toBe(401);
  });
});
