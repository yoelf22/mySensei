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

// Regression: the dashboard course buttons must use event delegation + data
// attributes, NOT inline onclick string-building. The original inline-onclick
// version produced a JS syntax error (collapsed quote-escaping inside the
// template literal), which silently killed the whole dashboard script so
// load() never ran and /api/courses was never fetched. A true parse-check is
// blocked by the Workers test pool (no `new Function`); these structural
// assertions guard against reintroducing the fragile pattern.
it("dashboard wires course actions via delegation, not inline onclick", async () => {
  const html = await (await get("/dashboard")).text();
  expect(html).toContain('data-act="resume"');
  expect(html).toContain('data-act="pause"');
  expect(html).toContain('addEventListener("click"');
  expect(html).toContain("esc("); // interpolated fields are HTML-escaped
  expect(html).not.toContain("onclick="); // no fragile inline handlers
});
