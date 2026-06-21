// worker/test/pages.test.mjs
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.mjs";
const E = { ...env, SESSION_SECRET: "s" };
async function get(path) { const ctx = createExecutionContext(); const r = await worker.fetch(new Request("https://app" + path), E, ctx); await waitOnExecutionContext(ctx); return r; }
it("serves login + dashboard HTML", async () => {
  const login = await get("/"); expect(login.headers.get("Content-Type")).toContain("text/html");
  expect(await login.text()).toContain("/auth/request");
  const dash = await get("/dashboard"); expect(await dash.text()).toContain("/api/courses");
});
