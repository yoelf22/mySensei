import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/worker.mjs";
import { createCourse, getCourse } from "../src/db.mjs";

const TOKEN = "tok-123";
const E = { ...env, INTERNAL_TOKEN: TOKEN, APP_BASE_URL: "https://app" };
async function call(path, init) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://app" + path, init), E, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const auth = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" };

beforeEach(async () => { await env.DB.exec("DELETE FROM courses; DELETE FROM pages; DELETE FROM research_artifacts;"); });

describe("internal magic-link minting", () => {
  it("rejects without the internal token", async () => {
    expect((await call(`/internal/magic-link`, { method: "POST", body: JSON.stringify({ email: "me@x.com" }) })).status).toBe(401);
  });

  it("mints a verify URL backed by a real token row", async () => {
    await env.DB.exec("DELETE FROM magic_tokens;");
    const res = await call(`/internal/magic-link`, { method: "POST", headers: auth, body: JSON.stringify({ email: "Me@X.com" }) });
    expect(res.status).toBe(200);
    const { url } = await res.json();
    expect(url).toContain("/auth/verify?token=");
    const tok = url.match(/token=([a-z0-9]+)/)[1];
    const row = await env.DB.prepare("SELECT email FROM magic_tokens WHERE token = ?").bind(tok).first();
    expect(row.email).toBe("me@x.com"); // normalized to lowercase
  });

  it("400s when email is missing", async () => {
    expect((await call(`/internal/magic-link`, { method: "POST", headers: auth, body: JSON.stringify({}) })).status).toBe(400);
  });
});

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

describe("internal project API", () => {
  it("rejects without the internal token", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "research");
    expect((await call(`/internal/project/${id}`, {})).status).toBe(401);
  });

  it("appends an artifact then returns it in the project payload", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "research");
    const post = await call(`/internal/project/${id}/artifact`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ stage: "plan", type: "message", role: "user", content: "hi" }),
    });
    expect(post.status).toBe(200);
    const get = await call(`/internal/project/${id}`, { headers: auth });
    const payload = await get.json();
    expect(payload.course.kind).toBe("research");
    expect(payload.planThread[0].content).toBe("hi");
  });

  it("fresh research project has planVersion 0 and empty planDoc", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "research");
    const res = await call(`/internal/project/${id}`, { headers: auth });
    const payload = await res.json();
    expect(payload.course.planVersion).toBe(0);
    expect(payload.course.planDoc).toBe("");
  });
});
