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

it("dashboard cards link to open the course by status", async () => {
  const html = await (await get("/dashboard")).text();
  expect(html).toContain("function openHref(c)");
  expect(html).toContain('class="open"');
  expect(html).toContain("/onboard");      // draft target
  expect(html).toContain("/assessment");   // awaiting-assessment target
  expect(html).toContain("/syllabus");     // awaiting-approval target
  expect(html).toContain('return "/c/"+id;'); // built courses open the contents page
});

it("dashboard course cards expose a Share control wired by delegation", async () => {
  const html = await (await get("/dashboard")).text();
  expect(html).toContain("data-share");          // per-card share button
  expect(html).toContain("function share(");      // share handler
  expect(html).toContain("/api/courses/");
  expect(html).toContain("/share");
  expect(html).not.toContain("onclick=");          // delegation, no inline handlers
});

it("dashboard: owner gets an Admin link and no allowlist panel; non-owner keeps the quota panel", async () => {
  const html = await (await get("/dashboard")).text();
  expect(html).toContain('href="/admin"');        // owner-only Admin link
  expect(html).toContain("adminlink");
  expect(html).toContain("renderInvitePanel");      // non-owner quota panel
  expect(html).toContain("of 5 invites left");
  expect(html).not.toContain("/api/allowlist");      // owner allowlist UI lives on /admin now
  expect(html).not.toContain("loadInvite");
});

it("dashboard buttons: red Pause with confirm, blue Invite, separated Share, no onclick", async () => {
  const html = await (await get("/dashboard")).text();
  expect(html).toContain('class="danger" data-act="pause"'); // red pause
  expect(html).toContain('confirm("Pause this course?');       // double-check
  expect(html).toContain('data-act="resume"');                 // resume toggle stays
  expect(html).toContain('id="invbtn" class="blue"');          // blue invite
  expect(html).toContain('class="share-group"');               // share visually separated
  expect(html).not.toContain("onclick=");
});

import { adminPage } from "../src/pages.mjs";
it("adminPage renders the chart, summary, course table, and user management", async () => {
  const html = adminPage();
  expect(html).toContain("/api/admin/stats");   // fetches the feed
  expect(html).toContain("function chart(");     // inline SVG chart
  expect(html).toContain("Users");               // user management block
  expect(html).toContain("/api/allowlist");      // list + remove
  expect(html).toContain('class="blue"');        // blue invite button
  expect(html).not.toContain("onclick=");
});

it("adminPage: course table has a Lessons column; user list uses checkboxes + Remove selected", async () => {
  const html = adminPage();
  expect(html).toContain("<th>Lessons</th>");          // course-list column
  expect(html).toContain("esc(c.lessons)");             // lessons cell rendered
  expect(html).toContain('type="checkbox"');            // per-user checkbox
  expect(html).toContain("Remove selected");            // single bulk-remove button
  expect(html).toContain("function removeSelected(");   // handler present
  expect(html).toContain("/api/allowlist/remove");      // bulk remove reuses the endpoint
  expect(html).not.toContain("onclick=");
});
