# mySensei Plan 2c — Owner Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner invite/manage learners from the dashboard, and surface generation failures both as a dashboard badge and an email.

**Architecture:** A single `OWNER_EMAIL` gates owner-only Worker routes (invite, allowlist) and reveals a dashboard Invite panel. Generation workflows gain an `if: failure()` step that records `last_error` on the course (dashboard "⚠ delayed" badge, auto-cleared on the next success) and emails the owner. Plus two robustness fixes from the 2b review.

**Tech Stack:** Cloudflare Worker (ESM `.mjs`) + D1, GitHub Actions (Node 20 ESM), nodemailer (Gmail), `vitest` + `@cloudflare/vitest-pool-workers`, `node --test`.

## Global Constraints

- ESM `.mjs` everywhere; no new runtime dependencies. D1 binding `DB`.
- `OWNER_EMAIL` = `yoel.frischoff@gmail.com`, a Worker **variable** + a GitHub Actions **variable** (not a secret). `isOwner(email, env)` = `!!email && email.toLowerCase() === String(env.OWNER_EMAIL || "").toLowerCase()`.
- Owner-only routes: non-owner authenticated session → `403`; no session → `401`.
- Emails are sent via the existing Gmail path (the `send-mail` Action for invites; nodemailer directly in `report-failure.mjs`). Identity = email lowercased.
- The `last_error` column already exists in `courses`. Set it via the Worker internal API; `saveCurriculum` clears it (`last_error = NULL`) on every successful save.
- The dispatch/email patterns match `worker/src/email.mjs` and `worker/src/sweep.mjs` (POST to `api.github.com/repos/{OWNER}/{REPO}/dispatches` with `env.GITHUB_TOKEN`, `User-Agent: mySensei-worker`).
- `report-failure.mjs` is best-effort: it never exits non-zero and never throws past `main`.

---

## File Structure

**New:** `scripts/report-failure.mjs` (+ `scripts/report-failure.test.mjs`).
**Modified:** `worker/src/db.mjs`, `worker/src/internal.mjs`, `worker/src/worker.mjs`, `worker/src/email.mjs`, `worker/src/pages.mjs`, `worker/src/sweep.mjs`, `worker/wrangler.toml`, `scripts/lib/course-store.mjs`, `.github/workflows/{onboard,build-curriculum,deliver-lesson,record-quiz}.yml`, and the matching test files.

**Task order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.

---

## Task 1: db.mjs — allowlist management, setLastError, clear-on-save

**Files:** Modify `worker/src/db.mjs`; Test `worker/test/db.test.mjs`.

**Interfaces — Produces:**
- `addToAllowlist(env, email): Promise<void>` (INSERT OR IGNORE, lowercased)
- `listAllowlist(env): Promise<string[]>` (ordered by `added_at`)
- `removeFromAllowlist(env, email): Promise<void>`
- `setLastError(env, id, msg): Promise<void>`
- `saveCurriculum` clears `last_error` on success.

- [ ] **Step 1: Write the failing tests** — append to `worker/test/db.test.mjs` (merge the new names into the existing `../src/db.mjs` import lines — no duplicate import):

```js
// add to imports: addToAllowlist, listAllowlist, removeFromAllowlist, setLastError

describe("allowlist management", () => {
  it("add (case-insensitive, idempotent), list, remove", async () => {
    await addToAllowlist(env, "A@X.com");
    await addToAllowlist(env, "a@x.com"); // same lowercased — idempotent
    expect(await listAllowlist(env)).toContain("a@x.com");
    await removeFromAllowlist(env, "A@X.COM");
    expect(await listAllowlist(env)).not.toContain("a@x.com");
  });
});

describe("last_error", () => {
  it("setLastError sets it; saveCurriculum clears it on the next save", async () => {
    const { id } = await createCourse(env, "me@x.com");
    await setLastError(env, id, "boom");
    expect((await getCourse(env, id)).last_error).toBe("boom");
    await saveCurriculum(env, id, { progress: { status: "active" } });
    expect((await getCourse(env, id)).last_error).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd worker && npm test -- db` → FAIL (functions not exported).

- [ ] **Step 3: Implement in `worker/src/db.mjs`** (add near `isAllowlisted`):

```js
export async function addToAllowlist(env, email) {
  await env.DB.prepare("INSERT OR IGNORE INTO allowlist(email, added_at) VALUES(?, ?)").bind(norm(email), now()).run();
}
export async function listAllowlist(env) {
  const { results } = await env.DB.prepare("SELECT email FROM allowlist ORDER BY added_at").all();
  return results.map((r) => r.email);
}
export async function removeFromAllowlist(env, email) {
  await env.DB.prepare("DELETE FROM allowlist WHERE email = ?").bind(norm(email)).run();
}
export async function setLastError(env, id, msg) {
  await env.DB.prepare("UPDATE courses SET last_error = ?, updated_at = ? WHERE id = ?").bind(msg || null, now(), id).run();
}
```

In `saveCurriculum`, add `last_error=NULL` to the SET clause (it's a literal, no new bind):

```js
    `UPDATE courses SET subject=?, angle=?, settings=?, status=?, start_level=?, level=?,
       research=?, assessment=?, outline=?, progress=?, syllabus=?, last_error=NULL, updated_at=? WHERE id=?`,
```

- [ ] **Step 4: Run to verify it passes** — `cd worker && npm test -- db` → PASS.
- [ ] **Step 5: Commit** — `git add worker/src/db.mjs worker/test/db.test.mjs && git commit -m "worker: allowlist management + setLastError + clear last_error on save"`

---

## Task 2: Worker internal `/error` route + course-store `reportError`

**Files:** Modify `worker/src/internal.mjs`, `scripts/lib/course-store.mjs`; Test `worker/test/internal.test.mjs`.

**Interfaces:** `PUT /internal/course/:id/error {error}` (bearer) → `setLastError`. `reportError(courseId, msg): Promise<void>` (best-effort).

- [ ] **Step 1: Write the failing test** — append to `worker/test/internal.test.mjs` (add `getCourse` to the `../src/db.mjs` import):

```js
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
```

- [ ] **Step 2: Run to verify it fails** — `cd worker && npm test -- internal` → FAIL.

- [ ] **Step 3: Implement** — in `worker/src/internal.mjs`, import `setLastError` and replace the handler body so the path regex also matches `/error`:

```js
import { getCourse, courseToCurriculum, saveCurriculum, putPage, setLastError } from "./db.mjs";
// ...
export async function handleInternal(request, env, url) {
  const m = url.pathname.match(/^\/internal\/course\/([a-z0-9]+)(\/page|\/error)?$/);
  if (!m) return null;
  if (!internalOk(request, env)) return json({ error: "unauthorized" }, 401);
  const id = m[1];
  const sub = m[2]; // undefined | "/page" | "/error"

  if (sub === "/page" && request.method === "PUT") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    if (!body.path || typeof body.html !== "string") return json({ error: "missing path/html" }, 400);
    await putPage(env, id, String(body.path), body.html);
    return json({ ok: true });
  }
  if (sub === "/page") return json({ error: "method not allowed" }, 405);

  if (sub === "/error" && request.method === "PUT") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    await setLastError(env, id, String(body.error || ""));
    return json({ ok: true });
  }
  if (sub === "/error") return json({ error: "method not allowed" }, 405);

  if (request.method === "GET") {
    const row = await getCourse(env, id);
    if (!row) return json({ error: "not found" }, 404);
    return json(courseToCurriculum(row));
  }
  if (request.method === "PUT") {
    const row = await getCourse(env, id);
    if (!row) return json({ error: "not found" }, 404);
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    await saveCurriculum(env, id, body);
    return json({ ok: true });
  }
  return json({ error: "method not allowed" }, 405);
}
```

In `scripts/lib/course-store.mjs`, add:

```js
export async function reportError(courseId, msg) {
  try {
    await fetch(`${base()}/internal/course/${courseId}/error`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ error: String(msg || "") }),
    });
  } catch (e) {
    console.error("reportError failed:", e.message);
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `cd worker && npm test` (full suite; confirm the existing `/page` + GET/PUT internal tests still pass) → PASS.
- [ ] **Step 5: Commit** — `git add worker/src/internal.mjs scripts/lib/course-store.mjs worker/test/internal.test.mjs && git commit -m "worker: /internal/course/:id/error route + course-store reportError"`

---

## Task 3: `scripts/report-failure.mjs`

**Files:** Create `scripts/report-failure.mjs`, `scripts/report-failure.test.mjs`.

**Interfaces — Produces:** `run(): Promise<void>` — records `last_error` (via `reportError`) and emails `OWNER_EMAIL`; never throws. Auto-runs when invoked as a script.

- [ ] **Step 1: Write the failing test** — `scripts/report-failure.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "./report-failure.mjs";

test("records the error on the course and never throws (no mail creds → skips email)", async () => {
  process.env.COURSE_ID = "abc";
  process.env.APP_BASE_URL = "https://app.example";
  process.env.INTERNAL_TOKEN = "tok";
  delete process.env.MAIL_FROM; delete process.env.GMAIL_APP_PASSWORD; delete process.env.OWNER_EMAIL;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response("{}", { status: 200 }); };
  await run(); // must resolve, not reject
  assert.ok(calls.some((c) => /\/internal\/course\/abc\/error$/.test(c.url)));
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test scripts/report-failure.test.mjs` → FAIL (module not found).

- [ ] **Step 3: Implement `scripts/report-failure.mjs`**

```js
// scripts/report-failure.mjs
// Run by a workflow's `if: failure()` step: records last_error on the course and
// emails the owner. Best-effort — never throws and never exits non-zero, so it
// can't fail the run a second time or mask the original error.
import nodemailer from "nodemailer";
import { reportError } from "./lib/course-store.mjs";

const COURSE_ID = process.env.COURSE_ID || "";
const runUrl =
  `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${process.env.GITHUB_REPOSITORY || ""}` +
  `/actions/runs/${process.env.GITHUB_RUN_ID || ""}`;

export async function run() {
  const note = `A mySensei job failed for course ${COURSE_ID || "(unknown)"}. See ${runUrl}`;
  if (COURSE_ID) {
    try { await reportError(COURSE_ID, note); } catch (e) { console.error("reportError:", e.message); }
  }
  const from = process.env.MAIL_FROM, pass = process.env.GMAIL_APP_PASSWORD, to = process.env.OWNER_EMAIL;
  if (from && pass && to) {
    try {
      const t = nodemailer.createTransport({ service: "gmail", auth: { user: from, pass } });
      await t.sendMail({ from, to, subject: "mySensei: a course job failed", text: note + "\n" });
      console.log("owner notified:", to);
    } catch (e) { console.error("owner email failed:", e.message); }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => console.error(e)); // never rethrow
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test scripts/report-failure.test.mjs` → PASS. Also `node --check scripts/report-failure.mjs`.
- [ ] **Step 5: Commit** — `git add scripts/report-failure.mjs scripts/report-failure.test.mjs && git commit -m "scripts: report-failure (last_error + owner email), best-effort"`

---

## Task 4: Worker owner gate, isOwner flag, invite + allowlist routes, sendInvite

**Files:** Modify `worker/src/worker.mjs`, `worker/src/email.mjs`, `worker/wrangler.toml`; Test `worker/test/owner.test.mjs`.

**Interfaces — Produces:** `isOwner(email, env)`; `GET /api/courses` → `{courses, isOwner}`; `POST /api/invite {email}`; `GET /api/allowlist`; `POST /api/allowlist/remove {email}` (all owner-gated); `sendInvite(env, email)`.

- [ ] **Step 1: Write the failing test** — `worker/test/owner.test.mjs`:

```js
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
```

- [ ] **Step 2: Run to verify it fails** — `cd worker && npm test -- owner` → FAIL.

- [ ] **Step 3: Implement `sendInvite` in `worker/src/email.mjs`**

```js
export async function sendInvite(env, email) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "mySensei-worker",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: "send-mail",
      client_payload: {
        to: email,
        subject: "You're invited to mySensei",
        intro: "You've been added to mySensei. Open the link below, enter this email, and you'll get a one-click sign-in link.",
        url: `${env.APP_BASE_URL}/`,
      },
    }),
  });
  if (!res.ok) throw new Error(`invite dispatch failed: ${res.status}`);
}
```

- [ ] **Step 4: Wire the routes in `worker/src/worker.mjs`**

Add to the imports: `addToAllowlist, listAllowlist, removeFromAllowlist` (db.mjs) and `sendInvite` (email.mjs). Add the helper near `sessionEmail`:

```js
function isOwner(email, env) {
  return !!email && email.toLowerCase() === String(env.OWNER_EMAIL || "").toLowerCase();
}
```

In the `/api/courses` block, change the GET line to include `isOwner`:

```js
      if (method === "GET") return json({ courses: await listCourses(env, email), isOwner: isOwner(email, env) });
```

Add these route blocks immediately after the `/api/courses/:id/(pause|resume)` block (before `/submit`):

```js
    if (pathname === "/api/invite" && method === "POST") {
      const email = await sessionEmail(request, env);
      if (!email) return json({ error: "unauthorized" }, 401);
      if (!isOwner(email, env)) return json({ error: "forbidden" }, 403);
      let body; try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
      const invitee = String(body.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invitee)) return json({ error: "invalid email" }, 400);
      await addToAllowlist(env, invitee);
      await sendInvite(env, invitee);
      return json({ ok: true, email: invitee });
    }

    if (pathname === "/api/allowlist") {
      const email = await sessionEmail(request, env);
      if (!email) return json({ error: "unauthorized" }, 401);
      if (!isOwner(email, env)) return json({ error: "forbidden" }, 403);
      if (method === "GET") return json({ emails: await listAllowlist(env) });
      return json({ error: "method not allowed" }, 405);
    }

    if (pathname === "/api/allowlist/remove" && method === "POST") {
      const email = await sessionEmail(request, env);
      if (!email) return json({ error: "unauthorized" }, 401);
      if (!isOwner(email, env)) return json({ error: "forbidden" }, 403);
      let body; try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
      const target = String(body.email || "").trim().toLowerCase();
      if (target === String(env.OWNER_EMAIL || "").toLowerCase()) return json({ error: "cannot remove owner" }, 400);
      await removeFromAllowlist(env, target);
      return json({ ok: true });
    }
```

- [ ] **Step 5: Add `OWNER_EMAIL` to `worker/wrangler.toml`** under `[vars]`:

```toml
OWNER_EMAIL = "yoel.frischoff@gmail.com"
```

- [ ] **Step 6: Run to verify it passes** — `cd worker && npm test` → ALL PASS.
- [ ] **Step 7: Commit** — `git add worker/src/worker.mjs worker/src/email.mjs worker/wrangler.toml worker/test/owner.test.mjs && git commit -m "worker: owner gate + invite/allowlist routes + isOwner flag + sendInvite"`

---

## Task 5: Dashboard — Invite panel (owner-only) + failure badge

**Files:** Modify `worker/src/pages.mjs`; Test `worker/test/pages.test.mjs`.

**Interfaces — Consumes:** `/api/courses` `isOwner` + per-course `last_error`; `/api/invite`, `/api/allowlist`, `/api/allowlist/remove`.

- [ ] **Step 1: Write the failing test** — append to `worker/test/pages.test.mjs`:

```js
it("dashboard has an owner-gated invite panel and a failure badge", async () => {
  const html = await (await get("/dashboard")).text();
  expect(html).toContain("d.isOwner");          // invite UI gated on owner
  expect(html).toContain("/api/invite");
  expect(html).toContain("/api/allowlist");
  expect(html).toContain("c.last_error");        // badge driven by last_error
  expect(html).toContain("delayed");
});
```

- [ ] **Step 2: Run to verify it fails** — `cd worker && npm test -- pages` → FAIL.

- [ ] **Step 3: Implement in `worker/src/pages.mjs` `dashboardPage`**

Add a badge in the card render — change the card return line to include a badge when `c.last_error`:

```js
    var badge=c.last_error?' <span class="badge">⚠ delayed</span>':'';
    var open='<a class="open" href="'+esc(openHref(c))+'">Open</a>';
    return '<div class="c"><b>'+esc(c.subject||"(new course)")+'</b>'+badge+'<div class="muted">'+esc(c.status)+" · level "+esc(c.level||"?")+" · "+prog+'</div><p>'+open+btn+'</p></div>';
```

In `load()`, after rendering the list, reveal the invite panel for the owner — change the `.then(function(d){ … })` so its end calls `if(d.isOwner) loadInvite();`:

```js
  el.innerHTML=d.courses.map(function(c){ /* …unchanged… */ }).join("");
  if(d.isOwner) loadInvite();
```

Add an invite container to the dashboard body markup (after the `#list` div):

```html
<div id="invite" style="display:none"></div>
```

Add these functions in the `<script>` (alongside `load`/`act`):

```js
function loadInvite(){
  var box=document.getElementById("invite"); box.style.display="block";
  fetch("/api/allowlist").then(function(r){return r.ok?r.json():{emails:[]};}).then(function(d){
    var rows=(d.emails||[]).map(function(e){return '<li>'+esc(e)+' <button data-rm="'+esc(e)+'">remove</button></li>';}).join("");
    box.innerHTML='<h2>Invite</h2><p><input id="invemail" type="email" placeholder="friend@example.com"> <button id="invbtn">Invite</button></p><p id="invmsg" class="muted"></p><ul class="allow">'+rows+'</ul>';
  });
}
function invite(){
  var em=document.getElementById("invemail").value, msg=document.getElementById("invmsg");
  fetch("/api/invite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em})})
    .then(function(r){msg.textContent=r.ok?("Invited "+em):"Could not invite (check the address).";if(r.ok)loadInvite();});
}
function rmAllow(email){fetch("/api/allowlist/remove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email})}).then(loadInvite);}
```

Wire the invite-panel events via delegation on `#invite` (add next to the existing `#list` delegation):

```js
document.getElementById("invite").addEventListener("click",function(e){
  if(e.target.id==="invbtn")invite();
  var rm=e.target.closest("button[data-rm]"); if(rm)rmAllow(rm.getAttribute("data-rm"));
});
```

Add styles to the shared `SHELL` `<style>` (after the `a.open` rule):

```css
.badge{font-family:system-ui,sans-serif;font-size:.75rem;color:#fff;background:#b4541f;border-radius:.3rem;padding:.05rem .4rem}
#invite{border-top:1px solid #e7e1d5;margin-top:2rem;padding-top:1rem}
.allow{list-style:none;padding:0;font-family:system-ui,sans-serif;font-size:.9rem}
.allow li{padding:.3rem 0}
```

- [ ] **Step 4: Run to verify it passes** — `cd worker && npm test -- pages` → PASS. Then parse-check the dashboard script:

```bash
node --input-type=module -e 'import { dashboardPage } from "./worker/src/pages.mjs"; const s=[...dashboardPage().matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]); for(const x of s){new Function(x)} console.log("ok")'
```
Expected: `ok`.

- [ ] **Step 5: Commit** — `git add worker/src/pages.mjs worker/test/pages.test.mjs && git commit -m "dashboard: owner invite panel + failure badge"`

---

## Task 6: Robustness — runSweep logging + deliver-lesson concurrency

**Files:** Modify `worker/src/sweep.mjs`, `.github/workflows/deliver-lesson.yml`; Test `worker/test/sweep.test.mjs`.

- [ ] **Step 1: Write the failing test** — append to `worker/test/sweep.test.mjs`:

```js
it("runSweep still resolves and logs when a dispatch fails", async () => {
  const due = await createCourse(env, "me@x.com");
  await saveCurriculum(env, due.id, { settings: dailyAt(12), progress: { status: "active" } });
  globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 }));
  const errs = [];
  const orig = console.error; console.error = (...a) => errs.push(a.join(" "));
  try {
    const res = await runSweep(E, NOON_UTC); // must not throw
    expect(res.dispatched).toContain(due.id);
    expect(errs.some((e) => e.includes(due.id))).toBe(true);
  } finally { console.error = orig; }
});
```

- [ ] **Step 2: Run to verify it fails** — `cd worker && npm test -- sweep` → FAIL (no error logged).

- [ ] **Step 3: Implement in `worker/src/sweep.mjs`** — replace `runSweep`:

```js
export async function runSweep(env, now) {
  const courses = await listActiveCourses(env);
  const due = dueCourseIds(courses, now);
  const results = await Promise.allSettled(due.map((id) => fireDispatch(env, id)));
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`sweep dispatch failed for ${due[i]}:`, r.reason && r.reason.message);
  });
  return { dispatched: due };
}
```

- [ ] **Step 4: Add concurrency to `.github/workflows/deliver-lesson.yml`** — after the `on:` block (top level, sibling of `permissions`):

```yaml
concurrency:
  group: deliver-${{ github.event.client_payload.courseId }}
  cancel-in-progress: false
```

- [ ] **Step 5: Run to verify it passes** — `cd worker && npm test -- sweep` → PASS. Validate YAML: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deliver-lesson.yml'))" && echo OK`.
- [ ] **Step 6: Commit** — `git add worker/src/sweep.mjs .github/workflows/deliver-lesson.yml && git commit -m "robustness: log sweep dispatch failures; per-course concurrency on deliver-lesson"`

---

## Task 7: Generation workflows — failure → report owner

**Files:** Modify `.github/workflows/onboard.yml`, `build-curriculum.yml`, `deliver-lesson.yml`, `record-quiz.yml`.

Add this as the **last step of the job** in each of the four workflows (it runs only when an earlier step failed):

```yaml
      - name: Report failure to owner
        if: failure()
        env:
          COURSE_ID: ${{ github.event.client_payload.courseId }}
          APP_BASE_URL: ${{ vars.APP_BASE_URL }}
          INTERNAL_TOKEN: ${{ secrets.INTERNAL_TOKEN }}
          OWNER_EMAIL: ${{ vars.OWNER_EMAIL }}
          MAIL_FROM: ${{ vars.MAIL_FROM }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
        run: node scripts/report-failure.mjs
```

- [ ] **Step 1:** Add the step to `onboard.yml`; validate: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/onboard.yml'))" && echo OK`.
- [ ] **Step 2:** Add the step to `build-curriculum.yml`; validate the same way.
- [ ] **Step 3:** Add the step to `deliver-lesson.yml`; validate.
- [ ] **Step 4:** Add the step to `record-quiz.yml`; validate.
- [ ] **Step 5: Commit** — `git add .github/workflows/onboard.yml .github/workflows/build-curriculum.yml .github/workflows/deliver-lesson.yml .github/workflows/record-quiz.yml && git commit -m "workflows: notify owner (badge + email) on generation failure"`

---

## Task 8: Deploy + verify (operational, owner-run)

**Files:** none. Prerequisite: all code tasks merged to `main`.

- [ ] **Step 1: Full suites** — `cd worker && npm test` ; `cd .. && node --test lib/ scripts/lib/ scripts/report-failure.test.mjs`.
- [ ] **Step 2: Set the GitHub `OWNER_EMAIL` variable** — `gh variable set OWNER_EMAIL --body "yoel.frischoff@gmail.com"` (the Worker var ships in `wrangler.toml`).
- [ ] **Step 3: Deploy the Worker** — `cd worker && npx wrangler deploy` (confirm the `OWNER_EMAIL` binding is listed and the cron schedule remains).
- [ ] **Step 4: Smoke — invite.** Sign in as the owner → the dashboard shows the **Invite** panel → add a test address → confirm it appears in the allowlist and the `send-mail` Action runs. Remove it → confirm it disappears; confirm you can't remove your own owner address.
- [ ] **Step 5: Smoke — failure badge + email.** Fire a `lesson-due` (or other generation) dispatch for a course with a deliberately broken condition, OR temporarily break a secret, to confirm the `if: failure()` step records `last_error` (dashboard shows "⚠ delayed") and emails the owner; then a successful generation clears the badge. (Optional — failures are rare; the path is unit-tested.)

---

## Self-Review

**1. Spec coverage:** owner identity/`isOwner` → Tasks 4 (+ wrangler var) ; Invite box (routes + db + sendInvite + dashboard) → Tasks 1,4,5 ; failure badge+email (`last_error`, `/error` route, `reportError`, `report-failure.mjs`, per-workflow steps, dashboard badge) → Tasks 1,2,3,5,7 ; robustness (sweep logging, deliver-lesson concurrency) → Task 6 ; config/deploy → Tasks 4,8. All spec items mapped.

**2. Placeholder scan:** none — every step has complete code or an exact command; the workflow step is shown once and applied to four files in Task 7.

**3. Type consistency:** `isOwner(email, env)` used identically in `/api/courses` and the three owner routes and tests. `addToAllowlist/listAllowlist/removeFromAllowlist/setLastError` signatures match Task 1 ↔ their consumers (Tasks 2,4). `reportError(courseId, msg)` (Task 2) matches its caller in `report-failure.mjs` (Task 3). `last_error` column read as `row.last_error` (getCourse returns it un-parsed — it's not a JSON column) and cleared via the `last_error=NULL` literal in `saveCurriculum`. `OWNER_EMAIL` is a Worker var (Task 4) + a GitHub var (Tasks 7,8). The dashboard reads `d.isOwner` and `c.last_error` exactly as `/api/courses` returns them.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-plan-2c-owner-tooling.md`.
