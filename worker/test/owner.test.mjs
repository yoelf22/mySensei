import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../src/worker.mjs";
import { signSession } from "../src/auth.mjs";

const OWNER = "owner@x.com";
const E = { ...env, SESSION_SECRET: "s", OWNER_EMAIL: OWNER, GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", APP_BASE_URL: "https://app" };
async function call(path, init) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://app" + path, init), E, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
async function cookie(email) { return "session=" + (await signSession(email, "s")); }
const jh = async (email) => ({ Cookie: await cookie(email), "Content-Type": "application/json" });

beforeEach(async () => {
  await env.DB.exec("DELETE FROM allowlist; DELETE FROM courses;");
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 }));
});

describe("owner tooling", () => {
  it("/api/courses reports isOwner", async () => {
    expect((await (await call("/api/courses", { headers: await jh(OWNER) })).json()).isOwner).toBe(true);
    expect((await (await call("/api/courses", { headers: await jh("nobody@x.com") })).json()).isOwner).toBe(false);
  });
  it("invite/allowlist are 403 for a non-owner", async () => {
    expect((await call("/api/invite", { method: "POST", headers: await jh("nobody@x.com"), body: JSON.stringify({ email: "x@y.com" }) })).status).toBe(403);
    expect((await call("/api/allowlist", { headers: await jh("nobody@x.com") })).status).toBe(403);
  });
  it("owner invites: adds to allowlist + fires the invite dispatch", async () => {
    const res = await call("/api/invite", { method: "POST", headers: await jh(OWNER), body: JSON.stringify({ email: "New@Y.com" }) });
    expect(res.status).toBe(200);
    expect((await (await call("/api/allowlist", { headers: await jh(OWNER) })).json()).emails).toContain("new@y.com");
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.event_type).toBe("send-mail");
    expect(body.client_payload.to).toBe("new@y.com");
  });
  it("owner can remove, but not themselves", async () => {
    await call("/api/invite", { method: "POST", headers: await jh(OWNER), body: JSON.stringify({ email: "a@y.com" }) });
    expect((await call("/api/allowlist/remove", { method: "POST", headers: await jh(OWNER), body: JSON.stringify({ email: "a@y.com" }) })).status).toBe(200);
    expect((await call("/api/allowlist/remove", { method: "POST", headers: await jh(OWNER), body: JSON.stringify({ email: OWNER }) })).status).toBe(400);
  });
});
