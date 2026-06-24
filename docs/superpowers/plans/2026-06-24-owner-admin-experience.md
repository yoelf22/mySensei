# Owner Admin Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner a password-gated `/admin` dashboard (stats, cross-user course list, user management, invite), de-mix the personal `/dashboard`, and restyle the course-card buttons (red Pause + confirm, blue Invite, separated Share).

**Architecture:** A username+password login (`/admin/login`) verifies Worker-secret credentials with a constant-time hash compare and mints the existing owner session; the owner's email is refused on the magic-link path. The `/admin` page (stats chart + course table + user management) is re-applied from the unmerged `plan-4-admin-dashboard` branch onto the current `main`. The personal `/dashboard` keeps the sharing/quota features but moves owner user-management to `/admin` and restyles buttons.

**Tech Stack:** Cloudflare Worker + D1; vitest + `cloudflare:test` (`cd worker && npm test`). All changes are under `worker/`.

## Global Constraints

- **Worker tests only:** `cd worker && npm test` (vitest + `cloudflare:test`). NOT node:test. No new D1 migration in this feature.
- **Owner auth = password only.** Credentials in Worker config: `ADMIN_USERNAME` (var) + `ADMIN_PASSWORD_HASH` (secret) = lowercase hex SHA-256 of the password. Verify with a **constant-time** compare (never `===` on the secret), computing BOTH the username and password checks before deciding (no early-out timing oracle). On success mint `signSession(env.OWNER_EMAIL, env.SESSION_SECRET)`; on failure show a single generic "Wrong username or password" (no user-vs-password distinction).
- **Owner email is refused on the magic-link path:** `POST /auth/request` with an email equal to `env.OWNER_EMAIL` (case-insensitive) sends no link and still returns `{ ok: true }`.
- **`/admin` and `/api/admin/*` stay owner-session-gated** via the existing `isOwner(email, env)`. The page route redirects an unauthenticated visitor to `/admin/login`; the API returns 401/403.
- **"No names" in admin stats:** `adminStats` selects `subject, status, created_at` only — never `owner_email`. The result contains no email addresses.
- **Colors:** Pause = red (`.danger`, `#c0392b`); Invite = blue (`.blue`, `#1f6fb4`); Share keeps the accent button but is visually separated from Pause.
- **No inline `onclick`** (event delegation only; a regression test asserts `not.toContain("onclick=")`). HTML-escape interpolated values with the existing `esc()`.
- **Commits:** small, one per task, on a feature branch off `main`. End messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `worker/src/auth.mjs` | add `sha256Hex`, `timingSafeEqual` | **Modify** |
| `worker/test/auth.test.mjs` | helper tests | **Modify** |
| `worker/src/pages.mjs` | `adminLoginPage`, `adminPage`; de-mix + restyle `dashboardPage`; CSS | **Modify** |
| `worker/src/db.mjs` | add `adminStats` | **Modify** |
| `worker/test/db.test.mjs` | `adminStats` tests | **Modify** |
| `worker/src/worker.mjs` | `/admin/login` (GET+POST), `/admin`, `/api/admin/stats`, `/auth/request` owner guard | **Modify** |
| `worker/test/admin.test.mjs` | admin login + page + owner-refusal tests | **Create** |
| `worker/test/pages.test.mjs` | admin page + dashboard de-mix/button assertions | **Modify** |
| `worker/wrangler.toml` | `ADMIN_USERNAME` var | **Modify** |
| `SETUP.md` | admin secret setup note | **Modify** |

---

## Task 1: Auth helpers — `sha256Hex` + `timingSafeEqual`

**Files:**
- Modify: `worker/src/auth.mjs`
- Test: `worker/test/auth.test.mjs`

**Interfaces:**
- Consumes: `enc` (the module-level `TextEncoder` already in `auth.mjs`), `crypto.subtle`.
- Produces:
  - `sha256Hex(str) => Promise<string>` — lowercase hex SHA-256 of the UTF-8 string.
  - `timingSafeEqual(a, b) => boolean` — length-checked, constant-time char-xor compare.

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/auth.test.mjs` (extend the import from `../src/auth.mjs` to add `sha256Hex, timingSafeEqual`):

```javascript
describe("admin auth helpers", () => {
  it("sha256Hex matches a known vector", async () => {
    // SHA-256("abc")
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("timingSafeEqual compares by value and rejects length mismatch", () => {
    expect(timingSafeEqual("abcd", "abcd")).toBe(true);
    expect(timingSafeEqual("abcd", "abce")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — `sha256Hex is not a function`.

- [ ] **Step 3: Implement the helpers**

Append to `worker/src/auth.mjs`:

```javascript
export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(String(str)));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS (2 new helper tests + full existing suite).

- [ ] **Step 5: Commit**

```bash
git add worker/src/auth.mjs worker/test/auth.test.mjs
git commit -m "feat: sha256Hex + timingSafeEqual auth helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Admin login route + page + owner magic-link refusal

**Files:**
- Modify: `worker/src/pages.mjs`
- Modify: `worker/src/worker.mjs`
- Test: `worker/test/admin.test.mjs` (create)

**Interfaces:**
- Consumes: `sha256Hex`, `timingSafeEqual` (Task 1); `signSession`, `sessionCookie`, `isOwner`, `isAllowlisted`, `mintToken`, `sendMagicLink`, `getShare` (all already in `worker.mjs`).
- Produces:
  - `adminLoginPage(error) => html` (username + password form posting to `/admin/login`; shows a generic error when `error` is truthy).
  - `GET /admin/login` → the login page; `POST /admin/login` → verify → owner session + 302 `/admin`, or re-render with the error.
  - `POST /auth/request` refuses the owner email.

- [ ] **Step 1: Write the failing tests**

Create `worker/test/admin.test.mjs`:

```javascript
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../src/worker.mjs";
import { verifySession } from "../src/auth.mjs";

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
    const token = cookie.split("session=")[1].split(";")[0];
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — `/admin/login` 404s; the owner email still gets a link.

- [ ] **Step 3: Add `adminLoginPage` to `pages.mjs`**

Append to `worker/src/pages.mjs`:

```javascript
export function adminLoginPage(error) {
  return SHELL("mySensei — admin sign in", `<h1>Admin sign in</h1>
${error ? '<p class="muted" style="color:#b4541f">Wrong username or password.</p>' : ""}
<form method="POST" action="/admin/login">
<p><input type="text" name="username" placeholder="username" autocomplete="username" required></p>
<p><input type="password" name="password" placeholder="password" autocomplete="current-password" required></p>
<p><button type="submit">Sign in</button></p>
</form>`);
}
```

- [ ] **Step 4: Wire the routes + owner guard in `worker.mjs`**

Extend the `./auth.mjs` import to add the helpers:

```javascript
import { signSession, verifySession, mintToken, consumeToken, sha256Hex, timingSafeEqual } from "./auth.mjs";
```

Extend the `./pages.mjs` import to add the login page:

```javascript
import { loginPage, dashboardPage, verifyPage, sharePage, shareUnavailablePage, adminLoginPage } from "./pages.mjs";
```

Add the admin-login routes just before the existing `if (method === "POST" && pathname === "/auth/request")` block:

```javascript
    if (method === "GET" && pathname === "/admin/login") {
      return new Response(adminLoginPage(false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (method === "POST" && pathname === "/admin/login") {
      const f = await request.formData();
      const username = String(f.get("username") || "");
      const password = String(f.get("password") || "");
      const okUser = !!env.ADMIN_USERNAME && timingSafeEqual(username, env.ADMIN_USERNAME);
      const okPass = !!env.ADMIN_PASSWORD_HASH && timingSafeEqual(await sha256Hex(password), env.ADMIN_PASSWORD_HASH);
      if (!okUser || !okPass) {
        return new Response(adminLoginPage(true), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      const cookie = sessionCookie(await signSession(env.OWNER_EMAIL, env.SESSION_SECRET));
      return new Response(null, { status: 302, headers: { Location: "/admin", "Set-Cookie": cookie } });
    }
```

In the `POST /auth/request` block, add the owner guard right after the email is parsed (before the `if (email) {` body does its work). Replace:

```javascript
      if (email) {
        let boundShare = null;
```

with:

```javascript
      if (email && email === String(env.OWNER_EMAIL || "").toLowerCase()) {
        return json({ ok: true }); // the owner signs in at /admin/login, not via magic links
      }
      if (email) {
        let boundShare = null;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS (the new admin-login + owner-refusal tests + the full existing suite — the existing `/auth/request` allowlisted tests still pass since they use non-owner emails).

- [ ] **Step 6: Commit**

```bash
git add worker/src/pages.mjs worker/src/worker.mjs worker/test/admin.test.mjs
git commit -m "feat: /admin/login password auth + owner refused on magic-link path

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `adminStats` data aggregation

**Files:**
- Modify: `worker/src/db.mjs`
- Test: `worker/test/db.test.mjs`

**Interfaces:**
- Consumes: `env.DB`.
- Produces: `adminStats(env) => { courses: [{topic, status, startedAt}], series: [{date, total}], summary: {started, active, paused, done} }` — courses with a non-empty `subject`, newest-first; cumulative count by calendar day (ascending); status tallies; **no email addresses** in the result.

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/db.test.mjs` (extend the `../src/db.mjs` import with `adminStats`):

```javascript
describe("adminStats", () => {
  async function seed(id, subject, status, createdAt) {
    await env.DB.prepare(
      "INSERT INTO courses(id, owner_email, status, subject, created_at, updated_at) VALUES(?,?,?,?,?,?)",
    ).bind(id, "u@x.com", status, subject, createdAt, createdAt).run();
  }
  beforeEach(async () => { await env.DB.exec("DELETE FROM courses;"); });

  it("cumulative series, excludes empty-subject drafts, tallies status, no emails", async () => {
    await seed("a1", "Chess", "active", "2026-06-01T10:00:00Z");
    await seed("a2", "Go", "paused", "2026-06-01T12:00:00Z");
    await seed("a3", "Tea", "done", "2026-06-03T09:00:00Z");
    await seed("a4", "", "draft", "2026-06-04T09:00:00Z"); // empty subject → excluded
    const s = await adminStats(env);
    expect(s.summary).toEqual({ started: 3, active: 1, paused: 1, done: 1 });
    expect(s.series).toEqual([{ date: "2026-06-01", total: 2 }, { date: "2026-06-03", total: 3 }]);
    expect(s.courses.length).toBe(3);
    expect(JSON.stringify(s)).not.toMatch(/@/); // never leaks an email
  });

  it("returns empty shapes when there are no started courses", async () => {
    const s = await adminStats(env);
    expect(s.courses).toEqual([]);
    expect(s.series).toEqual([]);
    expect(s.summary).toEqual({ started: 0, active: 0, paused: 0, done: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — `adminStats is not a function`.

- [ ] **Step 3: Implement `adminStats`**

Append to `worker/src/db.mjs`:

```javascript
export async function adminStats(env) {
  const { results } = await env.DB.prepare(
    "SELECT subject, status, created_at FROM courses WHERE subject IS NOT NULL AND subject != '' ORDER BY created_at DESC",
  ).all();
  const courses = results.map((r) => ({ topic: r.subject, status: r.status, startedAt: r.created_at }));

  const byDay = new Map();
  for (const r of results) {
    const day = String(r.created_at).slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  let running = 0;
  const series = [...byDay.keys()].sort().map((date) => {
    running += byDay.get(date);
    return { date, total: running };
  });

  const summary = {
    started: courses.length,
    active: courses.filter((c) => c.status === "active").length,
    paused: courses.filter((c) => c.status === "paused").length,
    done: courses.filter((c) => c.status === "done").length,
  };
  return { courses, series, summary };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS (2 new `adminStats` tests + full suite).

- [ ] **Step 5: Commit**

```bash
git add worker/src/db.mjs worker/test/db.test.mjs
git commit -m "feat: adminStats — started-courses series, status summary, no emails

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `/admin` page + stats feed

**Files:**
- Modify: `worker/src/worker.mjs`
- Modify: `worker/src/pages.mjs`
- Test: `worker/test/admin.test.mjs` (extend), `worker/test/pages.test.mjs` (extend)

**Interfaces:**
- Consumes: `adminStats` (Task 3); `sessionEmail`, `isOwner` (in `worker.mjs`); `SHELL` (in `pages.mjs`).
- Produces:
  - `GET /api/admin/stats` — owner-gated JSON `adminStats`.
  - `GET /admin` — owner session → `adminPage()`; otherwise 302 `/admin/login`.
  - `adminPage()` in `pages.mjs` — chart + summary + course table + user management (allowlist list/remove + invite); the invite button has class `blue`. Adds `.tbl` and `.blue` CSS.

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/admin.test.mjs` (reuse its `E`/`call` helpers; add at top: `import { signSession } from "../src/auth.mjs";` and a cookie helper):

```javascript
import { signSession as sign2 } from "../src/auth.mjs";
const ownerCookie = async () => ({ Cookie: "session=" + (await sign2("owner@x.com", "s")) });
const otherCookie = async () => ({ Cookie: "session=" + (await sign2("nobody@x.com", "s")) });

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
```

Append to `worker/test/pages.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — `/admin` 404/redirect-missing; `adminPage` not exported.

- [ ] **Step 3: Add `.tbl` and `.blue` CSS + `adminPage` to `pages.mjs`**

In the `SHELL` `<style>`, after the existing `.allow li{...}` rule, add:

```css
.tbl{border-collapse:collapse;width:100%;font-family:system-ui,sans-serif;font-size:.9rem;margin-top:1rem}
.tbl th,.tbl td{text-align:left;padding:.4rem .5rem;border-bottom:1px solid #e7e1d5}
.tbl th{color:#6b6457;font-weight:600}
.blue{background:#1f6fb4}
```

Append `adminPage` to `pages.mjs`:

```javascript
export function adminPage() {
  return SHELL("mySensei — admin", `<h1>Admin</h1>
<p><a class="open" href="/dashboard">← My courses</a></p>
<div id="stats" class="muted">Loading…</div>
<div id="users"></div>
<script>
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch];});}
function chart(series){
  if(!series.length) return "";
  var W=640,H=220,P=34;
  var xs=series.map(function(p){return Date.parse(p.date);});
  var minx=Math.min.apply(null,xs), maxx=Math.max.apply(null,xs);
  var maxy=Math.max.apply(null,series.map(function(p){return p.total;}));
  function X(t){return maxx===minx?(W/2):(P+(W-2*P)*(t-minx)/(maxx-minx));}
  function Y(v){return maxy===0?(H-P):(H-P-(H-2*P)*v/maxy);}
  var pts=series.map(function(p){return X(Date.parse(p.date)).toFixed(1)+","+Y(p.total).toFixed(1);}).join(" ");
  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img" aria-label="Total courses started over time">'
    +'<line x1="'+P+'" y1="'+(H-P)+'" x2="'+(W-P)+'" y2="'+(H-P)+'" stroke="#e7e1d5"/>'
    +'<polyline fill="none" stroke="#b4541f" stroke-width="2" points="'+pts+'"/>'
    +'<text x="'+P+'" y="'+(H-10)+'" font-size="11" fill="#6b6457">'+esc(series[0].date)+'</text>'
    +'<text x="'+(W-P)+'" y="'+(H-10)+'" font-size="11" fill="#6b6457" text-anchor="end">'+esc(series[series.length-1].date)+'</text>'
    +'<text x="'+P+'" y="'+(P-12)+'" font-size="11" fill="#6b6457">'+maxy+' total</text>'
    +'</svg>';
}
function render(d){
  var s=document.getElementById("stats"); s.className="";
  if(!d.courses.length){s.innerHTML="<p>No courses started yet.</p>";return;}
  var sum=d.summary;
  var rows=d.courses.map(function(c){
    return '<tr><td>'+esc(c.topic)+'</td><td>'+esc(c.status)+'</td><td>'+esc((c.startedAt||"").slice(0,10))+'</td></tr>';
  }).join("");
  s.innerHTML=chart(d.series)
    +'<p class="muted">'+sum.started+' started \xb7 '+sum.active+' active \xb7 '+sum.paused+' paused \xb7 '+sum.done+' done</p>'
    +'<table class="tbl"><thead><tr><th>Topic</th><th>Status</th><th>Started</th></tr></thead><tbody>'+rows+'</tbody></table>';
}
function loadStats(){
  fetch("/api/admin/stats").then(function(r){if(r.status===401||r.status===403){location.href="/admin/login";return;}return r.json();})
    .then(function(d){if(d)render(d);})
    .catch(function(){document.getElementById("stats").textContent="Couldn't load stats.";});
}
function loadInvite(){
  var box=document.getElementById("users");
  fetch("/api/allowlist").then(function(r){return r.ok?r.json():{emails:[]};}).then(function(d){
    var rows=(d.emails||[]).map(function(e){return '<li>'+esc(e)+' <button data-rm="'+esc(e)+'">remove</button></li>';}).join("");
    box.innerHTML='<h2>Users</h2><p><input id="invemail" type="email" placeholder="friend@example.com"> <button id="invbtn" class="blue">Invite</button></p><p id="invmsg" class="muted"></p><ul class="allow">'+rows+'</ul>';
  });
}
function invite(){
  var em=document.getElementById("invemail").value, msg=document.getElementById("invmsg");
  fetch("/api/invite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em})})
    .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
    .then(function(res){
      if(!res.ok){msg.textContent="Could not invite (check the address).";return;}
      msg.textContent=res.d.already?(em+" is already invited."):("Invited "+em);
      loadInvite();
    });
}
function rmAllow(email){fetch("/api/allowlist/remove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email})}).then(loadInvite);}
document.getElementById("users").addEventListener("click",function(e){
  if(e.target.id==="invbtn")invite();
  var rm=e.target.closest("button[data-rm]"); if(rm)rmAllow(rm.getAttribute("data-rm"));
});
loadStats(); loadInvite();
</script>`);
}
```

- [ ] **Step 4: Wire the routes in `worker.mjs`**

Extend the `./db.mjs` import to add `adminStats`:

```javascript
import { isAllowlisted, createCourse, listCourses, getCourse, setStatus, countActive, getPage, courseToCurriculum, addToAllowlist, listAllowlist, removeFromAllowlist, createDispute, countInvitesBy, createShare, getShare, claimShareUse, adminStats } from "./db.mjs";
```

Extend the `./pages.mjs` import to add `adminPage`:

```javascript
import { loginPage, dashboardPage, verifyPage, sharePage, shareUnavailablePage, adminLoginPage, adminPage } from "./pages.mjs";
```

Add the stats API route next to the other `/api/...` routes (e.g. right after the `/api/allowlist/remove` block):

```javascript
    if (pathname === "/api/admin/stats") {
      const email = await sessionEmail(request, env);
      if (!email) return json({ error: "unauthorized" }, 401);
      if (!isOwner(email, env)) return json({ error: "forbidden" }, 403);
      if (method === "GET") return json(await adminStats(env));
      return json({ error: "method not allowed" }, 405);
    }
```

Add the page route right after `if (method === "GET" && pathname === "/dashboard") ...`:

```javascript
    if (method === "GET" && pathname === "/admin") {
      const email = await sessionEmail(request, env);
      if (!isOwner(email, env)) return new Response(null, { status: 302, headers: { Location: "/admin/login" } });
      return html(adminPage());
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS (the new `/admin` + stats-feed + adminPage tests + full suite).

- [ ] **Step 6: Commit**

```bash
git add worker/src/worker.mjs worker/src/pages.mjs worker/test/admin.test.mjs worker/test/pages.test.mjs
git commit -m "feat: /admin page + /api/admin/stats feed (chart, course table, user mgmt)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: De-mix `/dashboard` + button UX

**Files:**
- Modify: `worker/src/pages.mjs`
- Test: `worker/test/pages.test.mjs`

**Interfaces:**
- Consumes: the `/api/courses` `isOwner` + `inviteRemaining` fields; `POST /api/courses/:id/share`; the existing `share()` behavior.
- Produces: a `dashboardPage()` where the owner sees an **Admin** link and NO invite/allowlist panel; a non-owner keeps the "N of 5 invites left" panel; all cards keep Open / Pause·Resume / Share; **Pause** is red (`.danger`) and asks `confirm()` before acting; the non-owner **Invite** button is `blue`; Share is visually separated (`.share-group`); CSS adds `.danger`, `.share-group`, `.actions`.

- [ ] **Step 1: Update the dashboard tests**

In `worker/test/pages.test.mjs`, replace the current dashboard invite-panel test (the one asserting `renderInvitePanel` / `d.isOwner` / `/api/allowlist`) with:

```javascript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — current dashboard has no Admin link, owner sees `loadInvite`/`/api/allowlist`, pause isn't red, no confirm.

- [ ] **Step 3: Add the dashboard CSS**

In the `SHELL` `<style>`, after the `.blue{...}` rule added in Task 4, add:

```css
.danger{background:#c0392b}
.actions{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-top:.6rem}
.share-group{margin-inline-start:.6rem;padding-inline-start:.7rem;border-inline-start:1px solid #e7e1d5}
```

- [ ] **Step 4: Replace `dashboardPage()`**

Replace the entire current `dashboardPage()` in `worker/src/pages.mjs` with:

```javascript
export function dashboardPage() {
  return SHELL("mySensei — my courses", `<h1>My courses</h1><p><a id="adminlink" class="open" href="/admin" style="display:none">Admin</a></p><p><button id="new">Start a new course</button></p><div id="list" class="muted">Loading…</div>
<div id="invite" style="display:none"></div>
<script>
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch];});}
function openHref(c){
  var id=encodeURIComponent(c.id);
  if(c.status==="draft")return "/c/"+id+"/onboard";
  if(c.status==="awaiting-assessment")return "/c/"+id+"/assessment";
  if(c.status==="awaiting-approval")return "/c/"+id+"/syllabus";
  return "/c/"+id;
}
function renderInvitePanel(remaining){
  var box=document.getElementById("invite"); box.style.display="block";
  box.innerHTML='<h2>Invite</h2><p class="muted" id="invleft">'+esc(remaining)+' of 5 invites left</p><p><input id="invemail" type="email" placeholder="friend@example.com"> <button id="invbtn" class="blue">Invite</button></p><p id="invmsg" class="muted"></p>';
}
function invite(){
  var em=document.getElementById("invemail").value, msg=document.getElementById("invmsg");
  fetch("/api/invite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em})})
    .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
    .then(function(res){
      if(!res.ok){msg.textContent=(res.d&&res.d.error==="no invites left")?"You're out of invites.":"Could not invite (check the address).";return;}
      msg.textContent=res.d.already?(em+" is already invited."):("Invited "+em);
      var left=document.getElementById("invleft");if(left&&res.d.remaining!=null){left.textContent=res.d.remaining+" of 5 invites left";}
    });
}
function share(id){
  var box=document.querySelector('[data-sb="'+id+'"]'); if(box) box.textContent="…";
  fetch("/api/courses/"+id+"/share",{method:"POST"}).then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d||!d.url){ if(box) box.textContent="(couldn't make a link)"; return; }
    if(box){ box.innerHTML='<input readonly value="'+esc(d.url)+'" style="width:100%">'; box.querySelector("input").select(); }
  });
}
function load(){fetch("/api/courses").then(function(r){if(r.status===401){location.href="/";return;}return r.json();}).then(function(d){
  if(!d)return; var el=document.getElementById("list");
  if(d.isOwner){var a=document.getElementById("adminlink");if(a)a.style.display="inline";}
  else renderInvitePanel(d.inviteRemaining);
  if(!d.courses.length){el.textContent="No courses yet — start one.";return;}
  el.innerHTML=d.courses.map(function(c){
    var prog=c.progress?("module "+esc(c.progress.currentModule)):"";
    var btn="";
    if(c.status==="paused")btn='<button data-act="resume" data-id="'+esc(c.id)+'">Resume</button>';
    if(c.status==="active")btn='<button class="danger" data-act="pause" data-id="'+esc(c.id)+'">Pause</button>';
    var badge=c.last_error?' <span class="badge">⚠ delayed</span>':'';
    var open='<a class="open" href="'+esc(openHref(c))+'">Open</a>';
    var shareBtn=c.subject?'<span class="share-group"><button data-share="'+esc(c.id)+'">Share</button> <span class="muted" data-sb="'+esc(c.id)+'"></span></span>':'';
    return '<div class="c"><b>'+esc(c.subject||"(new course)")+'</b>'+badge+'<div class="muted">'+esc(c.status)+" \xb7 level "+esc(c.level||"?")+" \xb7 "+prog+'</div><p class="actions">'+open+btn+shareBtn+'</p></div>';
  }).join("");
});}
function act(id,what){
  if(what==="pause" && !confirm("Pause this course? Lessons stop until you resume.")) return;
  fetch("/api/courses/"+id+"/"+what,{method:"POST"}).then(function(r){if(r.status===409){alert("You're at your active-course limit — pause one first.");}load();});
}
document.getElementById("list").addEventListener("click",function(e){
  var b=e.target.closest("button[data-act]");if(b){act(b.getAttribute("data-id"),b.getAttribute("data-act"));return;}
  var s=e.target.closest("button[data-share]");if(s){share(s.getAttribute("data-share"));}
});
document.getElementById("invite").addEventListener("click",function(e){ if(e.target.id==="invbtn")invite(); });
document.getElementById("new").addEventListener("click",function(){fetch("/api/courses",{method:"POST"}).then(function(r){return r.json();}).then(function(d){location.href="/c/"+d.id+"/onboard";});});
load();
</script>`);
}
```

Note: the `\xb7` (single backslash) in the `.map` return is the `·` middle-dot, transcribed exactly as the current `dashboardPage` source has it — inside this `.mjs` template literal it resolves to the `·` character in the emitted HTML. Don't double the backslash.

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS (the two updated dashboard tests + full suite; the `not.toContain("onclick=")` and delegation regression tests still hold).

- [ ] **Step 6: Commit**

```bash
git add worker/src/pages.mjs worker/test/pages.test.mjs
git commit -m "feat: de-mix dashboard (Admin link, owner mgmt moved) + red Pause/confirm, blue Invite, separated Share

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Setup — `ADMIN_USERNAME` var + secret notes

**Files:**
- Modify: `worker/wrangler.toml`
- Modify: `SETUP.md`

**Interfaces:**
- Consumes: nothing (config + docs only).
- Produces: an `ADMIN_USERNAME` var in `wrangler.toml`; SETUP.md instructions for the `ADMIN_PASSWORD_HASH` secret and the owner-login flow.

- [ ] **Step 1: Add the `ADMIN_USERNAME` var**

In `worker/wrangler.toml`, under the existing `[vars]` block, add a line (pick the actual admin username; `admin` is a safe default placeholder the owner can change):

```toml
ADMIN_USERNAME = "admin"
```

- [ ] **Step 2: Add the SETUP.md note**

In `SETUP.md`, add a short `## Admin login` section near the deployment notes:

```markdown
## Admin login

The owner signs in at `/admin/login` with a username + password (not the
magic-link flow — the owner email is refused there).

1. Set the username in `worker/wrangler.toml` → `[vars] ADMIN_USERNAME`.
2. Generate the password hash and set it as a Worker secret:
   ```
   printf '%s' 'YOUR-ADMIN-PASSWORD' | shasum -a 256   # copy the 64-char hex
   cd worker && npx wrangler secret put ADMIN_PASSWORD_HASH   # paste the hex
   ```
3. Redeploy: `cd worker && npm run deploy`.

Then visit `/admin/login`, sign in, and you land on `/admin` (stats, the
cross-user course list, user management, and invites). Your personal courses
are at `/dashboard` (linked as "My courses").
```

- [ ] **Step 3: Verify the config parses**

Run (from `worker/`): `npx wrangler deploy --dry-run 2>&1 | tail -5`
Expected: a dry-run summary with no TOML parse error (it lists bindings including `ADMIN_USERNAME`). If `--dry-run` needs auth in this environment and errors on that alone, instead confirm the TOML is valid by eye against the surrounding `[vars]` entries.

- [ ] **Step 4: Commit**

```bash
git add worker/wrangler.toml SETUP.md
git commit -m "docs: ADMIN_USERNAME var + admin password-secret setup notes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Post-implementation (owner-operated)

1. Set `ADMIN_USERNAME` (wrangler.toml) + `ADMIN_PASSWORD_HASH` (secret) per SETUP.md.
2. `cd worker && npm run deploy`.
3. Visit `/admin/login`, sign in → `/admin`. Confirm the magic-link login no longer emails your owner address.
4. Retire the now-superseded `plan-4-admin-dashboard` branch (its work is re-applied here): `git push origin --delete plan-4-admin-dashboard` and remove its worktree (`git worktree remove .worktrees/admin-dashboard`).

---

## Self-Review

**Spec coverage** (against `2026-06-24-owner-admin-experience-design.md`):
- Owner password login + constant-time compare + mint owner session → Task 1 (helpers), Task 2 (route). ✓
- Owner refused on magic-link path → Task 2 (`/auth/request` guard). ✓
- Credentials in Worker secrets (`ADMIN_USERNAME` var + `ADMIN_PASSWORD_HASH` secret) → Task 2 (consumed), Task 6 (setup). ✓
- `/admin` owner-gated, redirect to `/admin/login` → Task 4. ✓
- `adminStats` (no emails) + `/api/admin/stats` + `adminPage` (chart/summary/table/user-mgmt) → Tasks 3, 4. ✓
- Blue invite (admin + non-owner dashboard) → Task 4 (admin), Task 5 (dashboard). ✓
- De-mixed dashboard (owner Admin link + no panel; non-owner quota panel; Share kept) → Task 5. ✓
- Red Pause + confirm; Resume toggle → Task 5. ✓
- No `onclick`, escaping → Tasks 4, 5 (assertions). ✓
- Setup/secrets + retire old branch → Task 6 + post-impl. ✓

**Placeholder scan:** none — every code step shows complete code; every test step shows full test code; the one config value (`ADMIN_USERNAME = "admin"`) is a real, changeable default.

**Type consistency:** `sha256Hex(str) => Promise<string>` / `timingSafeEqual(a,b) => boolean` (Task 1) consumed in Task 2's `/admin/login`. `adminStats(env) => {courses, series, summary}` (Task 3) consumed by `/api/admin/stats` (Task 4) and rendered by `adminPage`'s `render()` reading `d.courses/d.series/d.summary` (Task 4). `adminLoginPage(error)` (Task 2) and `adminPage()` (Task 4) imported into `worker.mjs`. `.blue` CSS added in Task 4, reused in Task 5; `.tbl` in Task 4; `.danger/.share-group/.actions` in Task 5. The `/admin/login` redirect target is consistent across Task 4 (route + adminPage loadStats). Consistent. ✓
