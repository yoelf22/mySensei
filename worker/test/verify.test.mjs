import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../src/worker.mjs";
import { mintToken } from "../src/auth.mjs";

const E = { ...env, SESSION_SECRET: "s" };
async function call(path, init) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://app" + path, init), E, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const form = (body) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });

beforeEach(async () => { await env.DB.exec("DELETE FROM magic_tokens;"); });

describe("magic-link verify (scanner-safe interstitial)", () => {
  it("GET shows a POST form and does NOT consume the token (scanner-safe)", async () => {
    const tok = await mintToken(env, "me@x.com");
    const res = await call(`/auth/verify?token=${tok}`, {});
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain('method="POST"');
    expect(body).toContain(tok);
    // The token survived the GET — the human's POST still signs in.
    const post = await call(`/auth/verify`, form(`token=${tok}`));
    expect(post.status).toBe(302);
    expect(post.headers.get("Location")).toBe("/dashboard");
    expect(post.headers.get("Set-Cookie")).toContain("session=");
  });

  it("a consumed token can't be reused (single-use preserved)", async () => {
    const tok = await mintToken(env, "me@x.com");
    expect((await call(`/auth/verify`, form(`token=${tok}`))).status).toBe(302);
    expect((await call(`/auth/verify`, form(`token=${tok}`))).status).toBe(400);
  });

  it("POST with a bogus token is 400", async () => {
    expect((await call(`/auth/verify`, form(`token=bogus`))).status).toBe(400);
  });

  it("an expired/used token shows a one-click resend page (not a dead end)", async () => {
    const tok = await mintToken(env, "me@x.com");
    await call(`/auth/verify`, form(`token=${tok}`)); // consume it
    const res = await call(`/auth/verify`, form(`token=${tok}`)); // reuse
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("/auth/resend");
    expect(body).toContain(tok); // the form carries the old token for resend
  });
});

describe("magic-link resend", () => {
  const RE = { ...env, SESSION_SECRET: "s", APP_BASE_URL: "https://app", GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r" };
  async function callR(path, init) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://app" + path, init), RE, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }
  const json = (obj) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });

  it("resends a fresh link from an expired token, emailed to the address on file", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response("{}", { status: 200 }); });
    const tok = await mintToken(env, "me@x.com");
    await callR(`/auth/verify`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `token=${tok}` }); // consume
    const res = await callR(`/auth/resend`, json({ token: tok }));
    expect(res.status).toBe(200);
    expect(calls.length).toBe(1);
    expect(calls[0].body.event_type).toBe("send-mail");
    expect(calls[0].body.client_payload.to).toBe("me@x.com");
    const fresh = calls[0].body.client_payload.url.match(/token=([a-z0-9]+)/)[1];
    expect(fresh).not.toBe(tok); // a brand-new single-use token
  });

  it("resend with a bogus token is a silent 200 (no enumeration, no email)", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async () => { calls.push(1); return new Response("{}", { status: 200 }); });
    const res = await callR(`/auth/resend`, json({ token: "bogus" }));
    expect(res.status).toBe(200);
    expect(calls.length).toBe(0);
  });
});
