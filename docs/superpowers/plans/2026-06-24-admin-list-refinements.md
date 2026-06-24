# Admin List Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Opened" (distinct lessons actually opened) column to the admin course list via a client-side beacon, and replace the user-list per-row remove buttons with checkboxes + a single bulk Remove.

**Architecture:** A new `lesson_views` table records `(course_id, slug)` once per distinct lesson; the lesson page fires a fire-and-forget beacon (`POST /c/:id/:slug/opened`) on load, so email scanners (no JS) don't inflate the count. `adminStats` LEFT JOINs the per-course distinct count into each course as `opened`. The `/admin` user list renders a right-aligned checkbox per non-owner user and one blue Remove button.

**Tech Stack:** Cloudflare Worker + D1 (vitest + `cloudflare:test`, `cd worker && npm test`); one pure lib renderer (`lib/render-lesson.mjs`, node:test).

## Global Constraints

- **Worker tests** via vitest + `cloudflare:test` (`cd worker && npm test`); migrations auto-apply from `worker/migrations/`. The `lib/render-lesson.mjs` change is tested with `node --test lib/render-lesson.test.mjs` (the root `npm test` also collects worker tests that can't load under node:test — pre-existing, not in scope).
- **"Opened" = distinct lessons opened in a browser**, captured by a JS beacon — never a raw server fetch count. Counted distinct via `PRIMARY KEY (course_id, slug)` + `INSERT OR IGNORE`.
- **No identity stored with a view:** `lesson_views` holds only `course_id`, `slug`, `opened_at`. `adminStats` still selects no `owner_email`; `c.id` is used only for the JOIN/GROUP BY, never returned.
- **The owner's user row has NO checkbox** (can't remove yourself); the existing `/api/allowlist/remove` owner-guard (400) stays a backstop.
- **No inline `onclick`** (event delegation; a regression test asserts `not.toContain("onclick=")`); HTML-escape interpolated values with the existing `esc()`.
- **Commits:** small, one per task, on a feature branch off `main`. End messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `worker/migrations/0006_lesson_views.sql` | `lesson_views` table | **Create** |
| `worker/src/db.mjs` | `recordLessonView`; `adminStats` LEFT JOIN `opened` | **Modify** |
| `worker/test/db.test.mjs` | db tests | **Modify** |
| `worker/src/worker.mjs` | `POST /c/:id/:slug/opened`; `/api/allowlist` returns `owner` | **Modify** |
| `worker/test/admin.test.mjs` | beacon + allowlist-owner tests | **Modify** |
| `lib/render-lesson.mjs` | fire the beacon on load | **Modify** |
| `lib/render-lesson.test.mjs` | beacon-present test | **Modify** |
| `worker/src/pages.mjs` | adminPage: Opened column; checkboxes + bulk Remove; `.allow li` CSS | **Modify** |
| `worker/test/pages.test.mjs` | adminPage assertions | **Modify** |

---

## Task 1: `lesson_views` table + `recordLessonView` + `adminStats` opened count

**Files:**
- Create: `worker/migrations/0006_lesson_views.sql`
- Modify: `worker/src/db.mjs`
- Test: `worker/test/db.test.mjs`

**Interfaces:**
- Consumes: `env.DB`, `now()`.
- Produces:
  - `recordLessonView(env, courseId, slug) => void` — `INSERT OR IGNORE` a `(course_id, slug, opened_at)` row (distinct by the composite PK).
  - `adminStats(env)` — each `courses[]` object gains `opened` (number; 0 when none), via a LEFT JOIN distinct count. `series`/`summary` unchanged; no email in the output.

- [ ] **Step 1: Create the migration**

Create `worker/migrations/0006_lesson_views.sql`:

```sql
-- One row per distinct lesson a learner has opened (the composite PK dedups
-- repeat opens). Holds no identity — just course + lesson slug + timestamp.
CREATE TABLE lesson_views (
  course_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  PRIMARY KEY (course_id, slug)
);
```

- [ ] **Step 2: Write the failing tests**

Append to `worker/test/db.test.mjs` (extend the `../src/db.mjs` import with `recordLessonView, adminStats` if not already present):

```javascript
describe("lesson_views + opened count", () => {
  beforeEach(async () => { await env.DB.exec("DELETE FROM courses; DELETE FROM lesson_views;"); });

  it("recordLessonView is idempotent on (course_id, slug)", async () => {
    await recordLessonView(env, "c9", "lesson-01");
    await recordLessonView(env, "c9", "lesson-01");
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM lesson_views WHERE course_id='c9'").first();
    expect(row.n).toBe(1);
  });

  it("adminStats reports distinct opened lessons per course (0 when none)", async () => {
    await env.DB.prepare("INSERT INTO courses(id,owner_email,status,subject,created_at,updated_at) VALUES('cv1','u@x.com','active','Chess','2026-06-01T00:00:00Z','t')").run();
    await env.DB.prepare("INSERT INTO courses(id,owner_email,status,subject,created_at,updated_at) VALUES('cv2','u@x.com','active','Go','2026-06-02T00:00:00Z','t')").run();
    await recordLessonView(env, "cv1", "lesson-01-attempt1");
    await recordLessonView(env, "cv1", "lesson-01-attempt1"); // dup → still 1 distinct
    await recordLessonView(env, "cv1", "lesson-02-attempt1");
    const s = await adminStats(env);
    const opened = Object.fromEntries(s.courses.map((c) => [c.topic, c.opened]));
    expect(opened.Chess).toBe(2);
    expect(opened.Go).toBe(0);
    expect(JSON.stringify(s)).not.toMatch(/@/); // still no emails
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — `recordLessonView is not a function`, and `adminStats` returns no `opened`.

- [ ] **Step 4: Implement the db changes**

Append to `worker/src/db.mjs`:

```javascript
export async function recordLessonView(env, courseId, slug) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO lesson_views(course_id, slug, opened_at) VALUES(?,?,?)",
  ).bind(courseId, slug, now()).run();
}
```

Replace the existing `adminStats` query + `courses` mapping. Change:

```javascript
  const { results } = await env.DB.prepare(
    "SELECT subject, status, created_at FROM courses WHERE subject IS NOT NULL AND subject != '' ORDER BY created_at DESC",
  ).all();
  const courses = results.map((r) => ({ topic: r.subject, status: r.status, startedAt: r.created_at }));
```

to:

```javascript
  const { results } = await env.DB.prepare(
    `SELECT c.subject, c.status, c.created_at, COUNT(v.slug) AS opened
       FROM courses c
       LEFT JOIN lesson_views v ON v.course_id = c.id
       WHERE c.subject IS NOT NULL AND c.subject != ''
       GROUP BY c.id
       ORDER BY c.created_at DESC`,
  ).all();
  const courses = results.map((r) => ({ topic: r.subject, status: r.status, startedAt: r.created_at, opened: r.opened }));
```

(The `series` and `summary` computation below it is unchanged — `results` is still one row per course, so the by-day grouping and status tallies work as before.)

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS (the 2 new tests + the existing `adminStats` tests — those don't assert `opened`, so they still pass; the existing "no `@`" check still holds).

- [ ] **Step 6: Commit**

```bash
git add worker/migrations/0006_lesson_views.sql worker/src/db.mjs worker/test/db.test.mjs
git commit -m "feat: lesson_views table + recordLessonView; adminStats opened count

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Beacon route + allowlist owner field

**Files:**
- Modify: `worker/src/worker.mjs`
- Test: `worker/test/admin.test.mjs`

**Interfaces:**
- Consumes: `recordLessonView` (Task 1); `env.OWNER_EMAIL`, `listAllowlist`, `sessionEmail`, `isOwner`.
- Produces:
  - `POST /c/:id/:slug/opened` → records the view, returns 204. No auth, no body.
  - `GET /api/allowlist` → `{ emails, owner: env.OWNER_EMAIL }` (was `{ emails }`).

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/admin.test.mjs` (reuse its `E`/`call` helpers and the owner-cookie helper from earlier tasks):

```javascript
describe("lesson-open beacon", () => {
  beforeEach(async () => { await env.DB.exec("DELETE FROM lesson_views;"); });

  it("POST /c/:id/:slug/opened records the view (204) and dedups", async () => {
    const r = await call("/c/abc123/lesson-01-attempt1/opened", { method: "POST" });
    expect(r.status).toBe(204);
    await call("/c/abc123/lesson-01-attempt1/opened", { method: "POST" }); // dup
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM lesson_views WHERE course_id='abc123'").first();
    expect(row.n).toBe(1);
  });
});

describe("allowlist exposes the owner", () => {
  it("GET /api/allowlist includes owner", async () => {
    const res = await call("/api/allowlist", { headers: await ownerCookie() });
    expect((await res.json()).owner).toBe("owner@x.com");
  });
});
```

(If `ownerCookie` isn't already defined in this file from a prior task, add near the top: `const ownerCookie = async () => ({ Cookie: "session=" + encodeURIComponent(await signSession("owner@x.com", "s")) });` and ensure `signSession` is imported from `../src/auth.mjs`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — the beacon path falls through to the generic `/c/:id/:slug` GET (404 for POST), no row recorded; `/api/allowlist` has no `owner`.

- [ ] **Step 3: Add `recordLessonView` to the imports**

Extend the `./db.mjs` import in `worker.mjs` to add `recordLessonView`:

```javascript
import { isAllowlisted, createCourse, listCourses, getCourse, setStatus, countActive, getPage, courseToCurriculum, addToAllowlist, listAllowlist, removeFromAllowlist, createDispute, countInvitesBy, createShare, getShare, claimShareUse, adminStats, recordLessonView } from "./db.mjs";
```

- [ ] **Step 4: Add the beacon route**

Add immediately BEFORE the `const pm = pathname.match(/^\/c\/([a-z0-9]+)\/(.+)$/);` block:

```javascript
    const op = pathname.match(/^\/c\/([a-z0-9]+)\/(.+)\/opened$/);
    if (method === "POST" && op) {
      await recordLessonView(env, op[1], op[2]);
      return new Response(null, { status: 204 });
    }
```

- [ ] **Step 5: Add `owner` to the allowlist response**

In the `/api/allowlist` block, change:

```javascript
      if (method === "GET") return json({ emails: await listAllowlist(env) });
```

to:

```javascript
      if (method === "GET") return json({ emails: await listAllowlist(env), owner: env.OWNER_EMAIL });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS (the new beacon + allowlist-owner tests + full suite; the existing `/api/allowlist` owner-gating tests still pass — they don't assert the absence of `owner`).

- [ ] **Step 7: Commit**

```bash
git add worker/src/worker.mjs worker/test/admin.test.mjs
git commit -m "feat: lesson-open beacon route + allowlist owner field

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Beacon emitter on the lesson page

**Files:**
- Modify: `lib/render-lesson.mjs`
- Test: `lib/render-lesson.test.mjs`

**Interfaces:**
- Consumes: the lesson page's existing inline IIFE (runs on load); `location.pathname` (the page is served at `/c/:id/:slug`).
- Produces: a fire-and-forget `POST` to `location.pathname + "/opened"` on every lesson-page load.

- [ ] **Step 1: Write the failing test**

Append to `lib/render-lesson.test.mjs`:

```javascript
test("lesson page fires an 'opened' beacon on load", () => {
  const html = renderLessonHtml({
    curriculum: { subject: "X", settings: { languageCode: "en", language: "English", passThreshold: 0.7 } },
    lesson: { moduleId: 1, attempt: 1, title: "T", sections: [], quiz: [] },
    webhookUrl: "https://app/submit",
    courseId: "abc",
  });
  assert.match(html, /location\.pathname \+ "\/opened"/);
  assert.match(html, /keepalive/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test lib/render-lesson.test.mjs`
Expected: FAIL — no `/opened` beacon in the HTML.

- [ ] **Step 3: Add the beacon to the inline script**

In `lib/render-lesson.mjs`, find the start of the inline IIFE — the line `  var meta = JSON.parse(document.getElementById("meta").textContent);`. Immediately AFTER that line, add the beacon as the first action:

```javascript
  try { fetch(location.pathname + "/opened", { method: "POST", keepalive: true }); } catch (e) {}
```

(It runs once on load, before the quiz wiring. Wrapped in try/catch and fire-and-forget so it never affects the page.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test lib/render-lesson.test.mjs`
Expected: PASS (the new beacon test + all existing render-lesson tests).

- [ ] **Step 5: Commit**

```bash
git add lib/render-lesson.mjs lib/render-lesson.test.mjs
git commit -m "feat: lesson page fires an 'opened' beacon on load

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Admin UI — Opened column + checkbox bulk-remove

**Files:**
- Modify: `worker/src/pages.mjs`
- Test: `worker/test/pages.test.mjs`

**Interfaces:**
- Consumes: `adminStats` `opened` (Task 1); `/api/allowlist` `{ emails, owner }` (Task 2); `/api/allowlist/remove`.
- Produces: an `adminPage()` whose course table has an **Opened** column, and whose user list renders a right-aligned checkbox per non-owner user + a single blue **Remove** button (disabled until something is checked) that removes all checked users then refreshes.

- [ ] **Step 1: Update the adminPage test**

In `worker/test/pages.test.mjs`, replace the existing adminPage test with:

```javascript
it("adminPage: Opened column + checkbox bulk-remove user list", async () => {
  const html = adminPage();
  expect(html).toContain("/api/admin/stats");
  expect(html).toContain("function chart(");
  expect(html).toContain("<th>Opened</th>");        // new course-list column
  expect(html).toContain("esc(c.opened)");           // opened cell
  expect(html).toContain('type="checkbox"');         // per-user checkbox
  expect(html).toContain("data-email");
  expect(html).toContain('id="rmbtn"');              // single Remove button
  expect(html).toContain("e===owner");               // owner row gets no checkbox
  expect(html).not.toContain('data-rm="');           // old per-row remove buttons gone
  expect(html).toContain('class="blue"');            // invite + remove are blue
  expect(html).not.toContain("onclick=");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `worker/`): `npm test`
Expected: FAIL — no Opened column, still per-row `data-rm` buttons, no `rmbtn`.

- [ ] **Step 3: Add the `.allow li` flex CSS**

In `worker/src/pages.mjs`, in the `SHELL` `<style>`, replace the existing rule:

```css
.allow li{padding:.3rem 0}
```

with:

```css
.allow li{display:flex;justify-content:space-between;align-items:center;padding:.3rem 0}
```

- [ ] **Step 4: Add the Opened column in `adminPage`'s `render()`**

In `adminPage()`'s inline script, replace the `render()` row-building + table header. Change:

```javascript
  var rows=d.courses.map(function(c){
    return '<tr><td>'+esc(c.topic)+'</td><td>'+esc(c.status)+'</td><td>'+esc((c.startedAt||"").slice(0,10))+'</td></tr>';
  }).join("");
  s.innerHTML=chart(d.series)
    +'<p class="muted">'+sum.started+' started \xb7 '+sum.active+' active \xb7 '+sum.paused+' paused \xb7 '+sum.done+' done</p>'
    +'<table class="tbl"><thead><tr><th>Topic</th><th>Status</th><th>Started</th></tr></thead><tbody>'+rows+'</tbody></table>';
```

to:

```javascript
  var rows=d.courses.map(function(c){
    return '<tr><td>'+esc(c.topic)+'</td><td>'+esc(c.status)+'</td><td>'+esc((c.startedAt||"").slice(0,10))+'</td><td>'+esc(c.opened)+'</td></tr>';
  }).join("");
  s.innerHTML=chart(d.series)
    +'<p class="muted">'+sum.started+' started \xb7 '+sum.active+' active \xb7 '+sum.paused+' paused \xb7 '+sum.done+' done</p>'
    +'<table class="tbl"><thead><tr><th>Topic</th><th>Status</th><th>Started</th><th>Opened</th></tr></thead><tbody>'+rows+'</tbody></table>';
```

- [ ] **Step 5: Rewrite the user list (`loadInvite`), remove handler, and delegation**

In `adminPage()`'s inline script, replace `loadInvite()`, the old `rmAllow`, and the `#users` click listener with:

```javascript
function loadInvite(){
  var box=document.getElementById("users");
  fetch("/api/allowlist").then(function(r){return r.ok?r.json():{emails:[],owner:""};}).then(function(d){
    var owner=d.owner||"";
    var rows=(d.emails||[]).map(function(e){
      var cb=(e===owner)?'':'<input type="checkbox" data-email="'+esc(e)+'">';
      return '<li><span>'+esc(e)+'</span>'+cb+'</li>';
    }).join("");
    box.innerHTML='<h2>Users</h2><p><input id="invemail" type="email" placeholder="friend@example.com"> <button id="invbtn" class="blue">Invite</button></p><p id="invmsg" class="muted"></p><ul class="allow">'+rows+'</ul><p><button id="rmbtn" class="blue" disabled>Remove</button></p>';
  });
}
function removeChecked(){
  var boxes=document.querySelectorAll('#users input[type=checkbox]:checked');
  var emails=[]; for(var i=0;i<boxes.length;i++) emails.push(boxes[i].getAttribute("data-email"));
  if(!emails.length) return;
  Promise.all(emails.map(function(em){
    return fetch("/api/allowlist/remove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em})});
  })).then(loadInvite);
}
function syncRemoveBtn(){
  var any=document.querySelector('#users input[type=checkbox]:checked');
  var btn=document.getElementById("rmbtn"); if(btn) btn.disabled=!any;
}
document.getElementById("users").addEventListener("click",function(e){
  if(e.target.id==="invbtn")invite();
  if(e.target.id==="rmbtn")removeChecked();
});
document.getElementById("users").addEventListener("change",function(e){
  if(e.target.type==="checkbox") syncRemoveBtn();
});
```

(Keep the existing `invite()` function as-is. Delete the old `rmAllow` function and the old single click-listener that referenced `data-rm`.)

- [ ] **Step 6: Run the test to verify it passes**

Run (from `worker/`): `npm test`
Expected: PASS (the updated adminPage test + full suite).

- [ ] **Step 7: Commit**

```bash
git add worker/src/pages.mjs worker/test/pages.test.mjs
git commit -m "feat: admin Opened column + checkbox bulk-remove user list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Post-implementation (owner-operated)

After merge: apply the migration + redeploy (the beacon + opened count need the new table and worker):

```bash
cd worker && npx wrangler d1 migrations apply mysensei --remote
npm run deploy
```

Live check: open a lesson page in a browser, then visit `/admin` and confirm that course's "Opened" went up; check a user's box and confirm the single Remove button enables and removes them.

---

## Self-Review

**Spec coverage** (against `2026-06-24-admin-list-refinements-design.md`):
- `lesson_views` table (distinct via composite PK) → Task 1. ✓
- `recordLessonView` (INSERT OR IGNORE) → Task 1. ✓
- `adminStats` LEFT JOIN `opened`, no email leak → Task 1. ✓
- Beacon route `POST /c/:id/:slug/opened` (204, before the GET route) → Task 2. ✓
- `/api/allowlist` returns `owner` → Task 2. ✓
- Beacon emitter on lesson load (`keepalive`, fire-and-forget) → Task 3. ✓
- Opened column in the admin course table → Task 4. ✓
- User list: right-aligned checkbox per non-owner, owner omitted, single disabled-until-checked Remove, bulk remove + reload → Task 4. ✓
- No identity stored / no inline onclick / escaping → Tasks 1, 4. ✓

**Placeholder scan:** none — every code step shows complete before/after code; every test step shows full test code.

**Type consistency:** `recordLessonView(env, courseId, slug)` (Task 1) consumed in Task 2's beacon route. `adminStats` `courses[].opened` (Task 1) consumed by Task 4's `render()` (`esc(c.opened)`). `/api/allowlist` `{ emails, owner }` (Task 2) consumed by Task 4's `loadInvite()` (`d.owner`, `e===owner`). The beacon URL `location.pathname + "/opened"` (Task 3) matches the route regex `/^\/c\/([a-z0-9]+)\/(.+)\/opened$/` (Task 2). `id="rmbtn"` / `data-email` / `type="checkbox"` consistent between Task 4's render and its handlers. Consistent. ✓
