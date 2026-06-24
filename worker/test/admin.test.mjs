import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../src/worker.mjs";
import { verifySession } from "../src/auth.mjs";
import { signSession as sign2 } from "../src/auth.mjs";
const ownerCookie = async () => ({ Cookie: "session=" + (await sign2("owner@x.com", "s")) });
const otherCookie = async () => ({ Cookie: "session=" + (await sign2("nobody@x.com", "s")) });

// ADMIN_PASSWORD_HASH below is SHA-256("abc").
const E = { ...env, SESSION_SECRET: "s", OWNER_EMAIL: "owner@x.com",
  ADMIN_USERNAME: "boss", ADMIN_PASSWORD_HASH: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", APP_BASE_URL: "https://app" };

async function call(path, init) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://app" + path, init), E, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
function form(obj) {
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: Object.entries(obj).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&") };
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM allowlist; DELETE FROM magic_tokens; DELETE FROM courses;");
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 }));
});

describe("admin login", () => {
  it("GET /admin/login serves the form", async () => {
    const html = await (await call("/admin/login", {})).text();
    expect(html).toContain('action="/admin/login"');
    expect(html).toContain('name="password"');
  });

  it("correct credentials mint the owner session and redirect to /admin", async () => {
    const res = await call("/admin/login", form({ username: "boss", password: "abc" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin");
    const cookie = res.headers.get("Set-Cookie") || "";
    expect(cookie).toContain("session=");
    const token = decodeURIComponent(cookie.split("session=")[1].split(";")[0]);
    expect(await verifySession(token, "s")).toBe("owner@x.com");
  });

  it("wrong password or username re-renders with a generic error and no cookie", async () => {
    const bad = await call("/admin/login", form({ username: "boss", password: "nope" }));
    expect(bad.status).toBe(200);
    expect(await bad.text()).toMatch(/wrong username or password/i);
    expect(bad.headers.get("Set-Cookie")).toBe(null);
    const badUser = await call("/admin/login", form({ username: "nobody", password: "abc" }));
    expect(badUser.status).toBe(200);
    expect(badUser.headers.get("Set-Cookie")).toBe(null);
    expect(await badUser.text()).toMatch(/wrong username or password/i);
  });
});

describe("/admin page + stats feed", () => {
  it("GET /admin serves the page for the owner, redirects others to /admin/login", async () => {
    expect((await call("/admin", { headers: await ownerCookie() })).status).toBe(200);
    const other = await call("/admin", { headers: await otherCookie() });
    expect(other.status).toBe(302);
    expect(other.headers.get("Location")).toBe("/admin/login");
    const anon = await call("/admin", {});
    expect(anon.status).toBe(302);
  });

  it("GET /api/admin/stats is owner-only", async () => {
    expect((await call("/api/admin/stats", { headers: await ownerCookie() })).status).toBe(200);
    expect((await call("/api/admin/stats", { headers: await otherCookie() })).status).toBe(403);
    expect((await call("/api/admin/stats", {})).status).toBe(401);
  });
});

describe("owner is refused on the magic-link path", () => {
  it("/auth/request with the owner email sends no link", async () => {
    const res = await call("/auth/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@x.com" }) });
    expect(res.status).toBe(200);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("/auth/request still sends to an allowlisted non-owner", async () => {
    await env.DB.prepare("INSERT INTO allowlist(email, added_at) VALUES('user@x.com','t')").run();
    await call("/auth/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "user@x.com" }) });
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
