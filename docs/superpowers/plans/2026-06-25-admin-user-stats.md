# Admin User Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, per user in the owner's `/admin` user list, how many courses they started and how many lessons they finished (passed).

**Architecture:** A new `listUsers(env)` joins the allowlist with per-owner course aggregates (started = subject-bearing courses; finished = `currentModule − 1` summed). A new owner-gated `GET /api/admin/users` feeds it, and `adminPage`'s user list renders the counts. No migration; worker-only.

**Tech Stack:** Cloudflare Worker + D1; vitest + `cloudflare:test` (`cd worker && npm test`). Both files under `worker/`.

## Global Constraints

- **Worker tests only:** `cd worker && npm test`. No new migration.
- **"Courses started"** = the user's courses with a non-empty `subject` (same rule as the admin chart). **"Lessons finished"** = `max(0, progress.currentModule − 1)` summed across their courses (passed lessons; null/malformed `progress` → 0).
- **Per-user stats are owner-only.** The chart feed (`/api/admin/stats`) stays email-free; the new per-user data is on a separate owner-gated endpoint, and the user list already shows emails.
- `GET /api/admin/users` is owner-gated exactly like `/api/admin/stats` (401 no session, 403 non-owner, 200 owner, 405 other method).
- No inline `onclick`; escape interpolated values with `esc()`; the middle-dot in the inline template is `\xb7` (single backslash, matching the existing `adminPage` usage).
- **Commits:** small, one per task, on a feature branch off `main`. End messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `worker/src/db.mjs` | `listUsers(env)` — allowlist enriched with per-user course/lesson counts | **Modify** |
| `worker/test/db.test.mjs` | `listUsers` aggregation test | **Modify** |
| `worker/src/worker.mjs` | `GET /api/admin/users` (owner-gated) | **Modify** |
| `worker/test/admin.test.mjs` | route gating test | **Modify** |
| `worker/src/pages.mjs` | `adminPage` user list fetches `/api/admin/users`, renders counts | **Modify** |
| `worker/test/pages.test.mjs` | adminPage user-list render test | **Modify** |

---

## Task 1: `listUsers` — allowlist with per-user counts

**Files:**
- Modify: `worker/src/db.mjs`
- Test: `worker/test/db.test.mjs`

**Interfaces:**
- Consumes: `listAllowlist`, `norm` (already in `db.mjs`); `env.DB`.
- Produces: `listUsers(env) => [ { email, courses, lessons } ]` — one entry per allowlisted email (order follows `listAllowlist`); `courses` = count of that user's subject-bearing courses; `lessons` = sum of `max(0, currentModule − 1)` over those courses; users with no courses → `{ courses: 0, lessons: 0 }`.

- [ ] **Step 1: Write the failing test**

Append to `worker/test/db.test.mjs` (extend the `../src/db.mjs` import with `listUsers`):

```javascript
describe("listUsers", () => {
  beforeEach(async () => { await env.DB.exec("DELETE FROM courses; DELETE FROM allowlist;"); });
  async function allow(email) {
    await env.DB.prepare("INSERT INTO allowlist(email, added_at) VALUES(?, ?)").bind(email, "t").run();
  }
  async function course(id, owner, subject, currentModule) {
    const progress = currentModule == null ? null : JSON.stringify({ currentModule });
    await env.DB.prepare(
      "INSERT INTO courses(id, owner_email, status, subject, progress, created_at, updated_at) VALUES(?,?,?,?,?,?,?)",
    ).bind(id, owner, "active", subject, progress, "t", "t").run();
  }

  it("counts started courses + finished (passed) lessons per allowlisted user", async () => {
    await allow("a@x.com");
    await allow("b@x.com");
    await course("c1", "a@x.com", "Chess", 3); // finished = 2
    await course("c2", "a@x.com", "Go", 1);     // finished = 0
    await course("c3", "a@x.com", "", 5);        // no subject → excluded
    await course("c4", "ghost@x.com", "Ghost", 2); // owner not allowlisted → not listed
    const users = await listUsers(env);
    const byEmail = Object.fromEntries(users.map((u) => [u.email, u]));
    expect(byEmail["a@x.com"]).toEqual({ email: "a@x.com", courses: 2, lessons: 2 });
    expect(byEmail["b@x.com"]).toEqual({ email: "b@x.com", courses: 0, lessons: 0 });
    expect(users.length).toBe(2); // only allowlisted emails
  });

  it("treats a course with no/malformed progress as 0 finished", async () => {
    await allow("a@x.com");
    await course("c1", "a@x.com", "Chess", null);
    const users = await listUsers(env);
    expect(users[0]).toEqual({ email: "a@x.com", courses: 1, lessons: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `worker/`): `npm test`
Expected: FAIL — `listUsers is not a function`.

- [ ] **Step 3: Implement `listUsers`**

Append to `worker/src/db.mjs`:

```javascript
export async function listUsers(env) {
  const emails = await listAllowlist(env);
  const { results } = await env.DB.prepare(
    "SELECT owner_email, subject, progress FROM courses WHERE subject IS NOT NULL AND subject != ''",
  ).all();
  const agg = {};
  for (const r of results) {
    const e = norm(r.owner_email);
    let finished = 0;
    try {
      const p = r.progress ? JSON.parse(r.progress) : null;
      finished = Math.max(0, ((p && p.currentModule) || 1) - 1);
    } catch { /* malformed progress → 0 */ }
    const a = agg[e] || (agg[e] = { courses: 0, lessons: 0 });
    a.courses += 1;
    a.lessons += finished;
  }
  return emails.map((email) => {
    const a = agg[norm(email)] || { courses: 0, lessons: 0 };
    return { email, courses: a.courses, lessons: a.lessons };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `worker/`): `npm test`
Expected: PASS (2 new `listUsers` tests + the full worker suite).

- [ ] **Step 5: Commit**

```bash
git add worker/src/db.mjs worker/test/db.test.mjs
git commit -m "feat: listUsers — allowlist with per-user course + finished-lesson counts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `/api/admin/users` route + user-list render

**Files:**
- Modify: `worker/src/worker.mjs`
- Modify: `worker/src/pages.mjs`
- Test: `worker/test/admin.test.mjs`, `worker/test/pages.test.mjs`

**Interfaces:**
- Consumes: `listUsers` (Task 1); `sessionEmail`, `isOwner` (in `worker.mjs`).
- Produces: `GET /api/admin/users` → owner-gated `{ users: [...] }`; `adminPage`'s `loadInvite` fetches it and renders each row as email + muted "N courses · M finished" + the (unchanged) checkbox and Remove-selected control.

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/admin.test.mjs` (reuse its `call` + `ownerCookie`/`otherCookie` helpers from the `/admin page + stats feed` block):

```javascript
describe("/api/admin/users", () => {
  it("is owner-only", async () => {
    expect((await call("/api/admin/users", { headers: await ownerCookie() })).status).toBe(200);
    expect((await call("/api/admin/users", { headers: await otherCookie() })).status).toBe(403);
    expect((await call("/api/admin/users", {})).status).toBe(401);
  });
});
```

Append to `worker/test/pages.test.mjs`:

```javascript
it("adminPage user list fetches /api/admin/users and shows per-user counts", async () => {
  const html = adminPage();
  expect(html).toContain("/api/admin/users");   // user list now reads the enriched feed
  expect(html).toContain("esc(u.courses)");       // courses count rendered
  expect(html).toContain("esc(u.lessons)");       // finished count rendered
  expect(html).toContain("finished");
  expect(html).not.toContain("onclick=");
});
```

(`ownerCookie`/`otherCookie` already exist in `admin.test.mjs`; `adminPage` is already imported in `pages.test.mjs`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — `/api/admin/users` 404s (so owner gets a non-200); the adminPage user list still references `/api/allowlist` for the listing, not `/api/admin/users`.

- [ ] **Step 3: Add the route in `worker.mjs`**

Extend the `./db.mjs` import to add `listUsers`:

```javascript
import { isAllowlisted, createCourse, listCourses, getCourse, setStatus, countActive, getPage, courseToCurriculum, addToAllowlist, listAllowlist, removeFromAllowlist, createDispute, countInvitesBy, createShare, getShare, claimShareUse, adminStats, listUsers } from "./db.mjs";
```

Add the route immediately after the `/api/admin/stats` block:

```javascript
    if (pathname === "/api/admin/users") {
      const email = await sessionEmail(request, env);
      if (!email) return json({ error: "unauthorized" }, 401);
      if (!isOwner(email, env)) return json({ error: "forbidden" }, 403);
      if (method === "GET") return json({ users: await listUsers(env) });
      return json({ error: "method not allowed" }, 405);
    }
```

- [ ] **Step 4: Update `loadInvite` in `adminPage` (`pages.mjs`)**

Replace the current `loadInvite` function:

```javascript
function loadInvite(){
  var box=document.getElementById("users");
  fetch("/api/allowlist").then(function(r){return r.ok?r.json():{emails:[]};}).then(function(d){
    var rows=(d.emails||[]).map(function(e){return '<li><span>'+esc(e)+'</span><input type="checkbox" class="usel" value="'+esc(e)+'"></li>';}).join("");
    box.innerHTML='<h2>Users</h2><p><input id="invemail" type="email" placeholder="friend@example.com"> <button id="invbtn" class="blue">Invite</button></p><p id="invmsg" class="muted"></p><ul class="allow">'+rows+'</ul><p><button id="rmsel">Remove selected</button></p>';
  });
}
```

with:

```javascript
function loadInvite(){
  var box=document.getElementById("users");
  fetch("/api/admin/users").then(function(r){return r.ok?r.json():{users:[]};}).then(function(d){
    var rows=(d.users||[]).map(function(u){return '<li><span>'+esc(u.email)+' <span class="muted">'+esc(u.courses)+' courses \xb7 '+esc(u.lessons)+' finished</span></span><input type="checkbox" class="usel" value="'+esc(u.email)+'"></li>';}).join("");
    box.innerHTML='<h2>Users</h2><p><input id="invemail" type="email" placeholder="friend@example.com"> <button id="invbtn" class="blue">Invite</button></p><p id="invmsg" class="muted"></p><ul class="allow">'+rows+'</ul><p><button id="rmsel">Remove selected</button></p>';
  });
}
```

(`invite()`, `removeSelected()`, and the `#users` delegation are unchanged. Remove still posts to `/api/allowlist/remove`. The middle-dot `\xb7` is a single backslash, matching the existing `adminPage` `render()` usage.)

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS (the new route + adminPage tests + the full suite; the existing adminPage test still finds `/api/allowlist` via the unchanged `/api/allowlist/remove` in `removeSelected`).

- [ ] **Step 6: Commit**

```bash
git add worker/src/worker.mjs worker/src/pages.mjs worker/test/admin.test.mjs worker/test/pages.test.mjs
git commit -m "feat: /api/admin/users + user list shows courses started and lessons finished

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Post-implementation (owner-operated)

Worker-only, no migration: `cd worker && npm run deploy`. Then on `/admin`, each user row shows "N courses · M finished".

---

## Self-Review

**Spec coverage** (against `2026-06-25-admin-user-stats-design.md`):
- `listUsers` (started = subject-bearing courses; finished = `currentModule − 1` summed; 0/0 for no courses; malformed progress → 0; only allowlisted emails) → Task 1. ✓
- `GET /api/admin/users` owner-gated (401/403/200/405) → Task 2. ✓
- `adminPage` user list reads `/api/admin/users` and renders email + "N courses · M finished" with the checkbox + Remove-selected preserved → Task 2. ✓
- Chart stays email-free (untouched `/api/admin/stats`) → no change needed; per-user data is on the new endpoint. ✓
- Tests: `listUsers` aggregation (Task 1), route gating + adminPage render (Task 2). ✓

**Placeholder scan:** none — every code step shows complete before/after code; every test step shows full test code.

**Type consistency:** `listUsers(env) => [{ email, courses, lessons }]` (Task 1) consumed by `/api/admin/users` (Task 2 route) and rendered by `loadInvite` reading `u.email`/`u.courses`/`u.lessons` (Task 2). The route returns `{ users: [...] }`; `loadInvite` reads `d.users`. `norm` keys both the aggregation and the allowlist lookup. Consistent. ✓
