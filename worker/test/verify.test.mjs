import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
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
});
