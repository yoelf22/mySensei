// worker/test/routes.test.mjs
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../src/worker.mjs";
import { signSession } from "../src/auth.mjs";

const E = { ...env, SESSION_SECRET: "s", GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r" };
async function call(path, init) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://app" + path, init), E, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
async function cookie(email) { return "session=" + (await signSession(email, "s")); }

beforeEach(async () => {
  await env.DB.exec("DELETE FROM allowlist; DELETE FROM courses; DELETE FROM magic_tokens;");
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 204 }));
});

describe("routes", () => {
  it("auth/request is 200 for non-allowlisted but sends nothing", async () => {
    const res = await call("/auth/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "x@y.com" }) });
    expect(res.status).toBe(200);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("dashboard API requires a session", async () => {
    expect((await call("/api/courses", {})).status).toBe(401);
  });
  it("create + list + cap on resume", async () => {
    const h = { Cookie: await cookie("me@x.com"), "Content-Type": "application/json" };
    const made = await (await call("/api/courses", { method: "POST", headers: h })).json();
    const list = await (await call("/api/courses", { headers: h })).json();
    expect(list.courses.map((c) => c.id)).toContain(made.id);
    // force 3 active, then a 4th resume is capped
    for (let i = 0; i < 3; i++) { const c = await (await call("/api/courses", { method: "POST", headers: h })).json(); await call(`/api/courses/${c.id}/resume`, { method: "POST", headers: h }); }
    const capped = await call(`/api/courses/${made.id}/resume`, { method: "POST", headers: h });
    expect(capped.status).toBe(409);
  });
});
