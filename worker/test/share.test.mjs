import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../src/worker.mjs";
import { signSession } from "../src/auth.mjs";
import { createCourse, getShare } from "../src/db.mjs";
import { createShare as mkShare, claimShareUse as claimUse } from "../src/db.mjs";

const E = { ...env, SESSION_SECRET: "s", OWNER_EMAIL: "owner@x.com", GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", APP_BASE_URL: "https://app" };
async function call(path, init) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://app" + path, init), E, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
async function cookie(email) { return "session=" + (await signSession(email, "s")); }
const jh = async (email) => ({ Cookie: await cookie(email), "Content-Type": "application/json" });

beforeEach(async () => {
  await env.DB.exec("DELETE FROM shares; DELETE FROM courses; DELETE FROM allowlist; DELETE FROM magic_tokens;");
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 }));
});

describe("POST /api/courses/:id/share", () => {
  it("owner mints a link to a course that has a subject", async () => {
    const { id } = await createCourse(env, "u@x.com", "Chess", "for clubs");
    const res = await call(`/api/courses/${id}/share`, { method: "POST", headers: await jh("u@x.com") });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toMatch(/^https:\/\/app\/share\/[a-z0-9]+$/);
    const token = body.url.split("/").pop();
    const share = await getShare(env, token);
    expect(share.subject).toBe("Chess");
    expect(share.created_by).toBe("u@x.com");
  });

  it("401 unauthenticated", async () => {
    const { id } = await createCourse(env, "u@x.com", "Chess", "x");
    expect((await call(`/api/courses/${id}/share`, { method: "POST" })).status).toBe(401);
  });

  it("404 for a non-owner or unknown course", async () => {
    const { id } = await createCourse(env, "u@x.com", "Chess", "x");
    expect((await call(`/api/courses/${id}/share`, { method: "POST", headers: await jh("other@x.com") })).status).toBe(404);
    expect((await call(`/api/courses/zzzznope12/share`, { method: "POST", headers: await jh("u@x.com") })).status).toBe(404);
  });

  it("400 for a bare draft with no subject", async () => {
    const { id } = await createCourse(env, "u@x.com");
    expect((await call(`/api/courses/${id}/share`, { method: "POST", headers: await jh("u@x.com") })).status).toBe(400);
  });
});

describe("GET /share/:token", () => {
  it("signed-in user: claims a use, creates a preset course, redirects to onboarding", async () => {
    const { token } = await mkShare(env, { subject: "Chess", angle: "for clubs", createdBy: "sharer@x.com" });
    const res = await call(`/share/${token}`, { headers: { Cookie: await cookie("rcpt@x.com") } });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toMatch(/^\/c\/[a-z0-9]+\/onboard$/);
    expect((await getShare(env, token)).uses).toBe(1);
  });

  it("unknown or full token shows the unavailable page", async () => {
    expect((await call(`/share/zzzznope12`, { headers: { Cookie: await cookie("rcpt@x.com") } })).status).toBe(200);
    const unknown = await call(`/share/zzzznope12`, {});
    expect(await unknown.text()).toMatch(/no longer available/i);

    const { token } = await mkShare(env, { subject: "X", angle: "", createdBy: "s@x.com", maxUses: 1 });
    await claimUse(env, token); // fill it
    const full = await call(`/share/${token}`, { headers: { Cookie: await cookie("rcpt@x.com") } });
    expect(await full.text()).toMatch(/no longer available/i);
    expect((await getShare(env, token)).uses).toBe(1); // not over-claimed
  });

  it("no session: shows the landing page with the subject", async () => {
    const { token } = await mkShare(env, { subject: "Chess", angle: "", createdBy: "s@x.com" });
    const res = await call(`/share/${token}`, {});
    const body = await res.text();
    expect(body).toContain("Chess");
    expect(body).toContain("/auth/request");
    expect(body).toContain(token); // the form carries the share token
  });
});

describe("onboarding prefill", () => {
  it("/c/:id/onboard renders the course subject + angle prefilled", async () => {
    const { id } = await createCourse(env, "u@x.com", "Chess", "for clubs");
    const html = await (await call(`/c/${id}/onboard`, {})).text();
    expect(html).toContain("Chess");
    expect(html).toContain("for clubs");
  });
});
