# Admin List Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-course "Lessons" (delivered) count to the admin course list, and replace the user list's per-row remove buttons with right-aligned checkboxes + a single "Remove selected" button.

**Architecture:** `adminStats` also reads each course's `progress` JSON and returns `lessons = progress.delivered.length`. `adminPage` renders the new Lessons column and reformats the user list with checkboxes; "Remove selected" loops the existing `POST /api/allowlist/remove` client-side. No new backend route, no migration.

**Tech Stack:** Cloudflare Worker + D1; vitest + `cloudflare:test` (`cd worker && npm test`). Both files under `worker/`.

## Global Constraints

- **Worker tests only:** `cd worker && npm test` (vitest + `cloudflare:test`). No new migration.
- **"Lessons" = delivered count**, from `progress.delivered.length` (0 when absent/malformed). Counts every lesson sent, including re-taught attempts.
- **No email in `adminStats` output** — it selects `subject, status, created_at, progress` (never `owner_email`); `progress` contains no email. The result must still serialize with no `@`.
- **Bulk remove reuses `POST /api/allowlist/remove`** (one request per checked email, client-side). No new endpoint. The server already blocks removing `OWNER_EMAIL` (400), so a checked owner row is a harmless no-op.
- **No inline `onclick`** — event delegation on `#users` (a regression test asserts `not.toContain("onclick=")`). HTML-escape interpolated values with `esc()`.
- **Commits:** small, one per task, on a feature branch off `main`. End messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `worker/src/db.mjs` | `adminStats` adds `lessons` per course | **Modify** |
| `worker/test/db.test.mjs` | adminStats lessons test | **Modify** |
| `worker/src/pages.mjs` | `adminPage`: Lessons column + checkbox user list + CSS | **Modify** |
| `worker/test/pages.test.mjs` | adminPage refinement assertions | **Modify** |

---

## Task 1: `adminStats` reports the delivered-lesson count

**Files:**
- Modify: `worker/src/db.mjs`
- Test: `worker/test/db.test.mjs`

**Interfaces:**
- Consumes: `env.DB`.
- Produces: `adminStats(env)` whose `courses` entries are now `{ topic, status, startedAt, lessons }`, where `lessons` = `progress.delivered.length` (0 when `progress` is null/malformed or has no `delivered` array). `series` and `summary` unchanged; no email in the output.

- [ ] **Step 1: Write the failing test**

Append to the existing `describe("adminStats", ...)` block in `worker/test/db.test.mjs`:

```javascript
  it("reports lessons = delivered count (0 when no progress), no email leak", async () => {
    await env.DB.exec("DELETE FROM courses;");
    await env.DB.prepare(
      "INSERT INTO courses(id, owner_email, status, subject, progress, created_at, updated_at) VALUES(?,?,?,?,?,?,?)",
    ).bind("c1", "u@x.com", "active", "Chess", JSON.stringify({ delivered: [{ module: 1 }, { module: 2 }, { module: 3 }] }), "2026-06-01T10:00:00Z", "2026-06-01T10:00:00Z").run();
    await env.DB.prepare(
      "INSERT INTO courses(id, owner_email, status, subject, progress, created_at, updated_at) VALUES(?,?,?,?,?,?,?)",
    ).bind("c2", "u@x.com", "active", "Go", null, "2026-06-02T10:00:00Z", "2026-06-02T10:00:00Z").run();
    const s = await adminStats(env);
    const byTopic = Object.fromEntries(s.courses.map((c) => [c.topic, c.lessons]));
    expect(byTopic.Chess).toBe(3);
    expect(byTopic.Go).toBe(0);
    expect(JSON.stringify(s)).not.toMatch(/@/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `worker/`): `npm test`
Expected: FAIL — `byTopic.Chess` is `undefined` (no `lessons` field yet).

- [ ] **Step 3: Implement**

In `worker/src/db.mjs`, replace the start of `adminStats` (the SELECT and the `courses` map):

```javascript
export async function adminStats(env) {
  const { results } = await env.DB.prepare(
    "SELECT subject, status, created_at FROM courses WHERE subject IS NOT NULL AND subject != '' ORDER BY created_at DESC",
  ).all();
  const courses = results.map((r) => ({ topic: r.subject, status: r.status, startedAt: r.created_at }));
```

with:

```javascript
export async function adminStats(env) {
  const { results } = await env.DB.prepare(
    "SELECT subject, status, created_at, progress FROM courses WHERE subject IS NOT NULL AND subject != '' ORDER BY created_at DESC",
  ).all();
  const courses = results.map((r) => {
    let lessons = 0;
    try {
      const p = r.progress ? JSON.parse(r.progress) : null;
      if (p && Array.isArray(p.delivered)) lessons = p.delivered.length;
    } catch { /* malformed progress → 0 */ }
    return { topic: r.subject, status: r.status, startedAt: r.created_at, lessons };
  });
```

(The `byDay`/`series`/`summary` code below is unchanged — it iterates `results`, which still has the rows.)

- [ ] **Step 4: Run the test to verify it passes**

Run (from `worker/`): `npm test`
Expected: PASS (the new lessons test + the existing adminStats tests + full suite).

- [ ] **Step 5: Commit**

```bash
git add worker/src/db.mjs worker/test/db.test.mjs
git commit -m "feat: adminStats reports per-course delivered-lesson count

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Lessons column + checkbox user list in `adminPage`

**Files:**
- Modify: `worker/src/pages.mjs`
- Test: `worker/test/pages.test.mjs`

**Interfaces:**
- Consumes: the `/api/admin/stats` `courses[].lessons` field (Task 1); the existing `/api/allowlist` and `POST /api/allowlist/remove`.
- Produces: `adminPage()` HTML whose course table has a **Lessons** column, and whose user list renders right-aligned checkboxes + a single "Remove selected" button wired by delegation.

- [ ] **Step 1: Write the failing test**

Append to `worker/test/pages.test.mjs` (the file already imports `adminPage`):

```javascript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `worker/`): `npm test`
Expected: FAIL — no Lessons column, no checkbox, no `removeSelected`.

- [ ] **Step 3: Add the CSS**

In `worker/src/pages.mjs`'s `SHELL` `<style>`, replace the line:

```css
.allow li{padding:.3rem 0}
```

with:

```css
.allow li{padding:.3rem 0;display:flex;justify-content:space-between;align-items:center}
input[type=checkbox]{width:auto}
```

(The `input[type=checkbox]{width:auto}` overrides the global `input{width:100%}` so checkboxes don't stretch.)

- [ ] **Step 4: Add the Lessons column in `render()`**

In `adminPage()`'s inline script, in `render()`, replace the rows builder and the table header. Change:

```javascript
  var rows=d.courses.map(function(c){
    return '<tr><td>'+esc(c.topic)+'</td><td>'+esc(c.status)+'</td><td>'+esc((c.startedAt||"").slice(0,10))+'</td></tr>';
  }).join("");
```

to:

```javascript
  var rows=d.courses.map(function(c){
    return '<tr><td>'+esc(c.topic)+'</td><td>'+esc(c.status)+'</td><td>'+esc((c.startedAt||"").slice(0,10))+'</td><td>'+esc(c.lessons)+'</td></tr>';
  }).join("");
```

and change the table header (in the same `render()` `s.innerHTML=` assignment):

```javascript
    +'<table class="tbl"><thead><tr><th>Topic</th><th>Status</th><th>Started</th></tr></thead><tbody>'+rows+'</tbody></table>';
```

to:

```javascript
    +'<table class="tbl"><thead><tr><th>Topic</th><th>Status</th><th>Started</th><th>Lessons</th></tr></thead><tbody>'+rows+'</tbody></table>';
```

- [ ] **Step 5: Reformat the user list + add `removeSelected`**

Replace `loadInvite()` (the rows builder + the `box.innerHTML`):

```javascript
function loadInvite(){
  var box=document.getElementById("users");
  fetch("/api/allowlist").then(function(r){return r.ok?r.json():{emails:[]};}).then(function(d){
    var rows=(d.emails||[]).map(function(e){return '<li>'+esc(e)+' <button data-rm="'+esc(e)+'">remove</button></li>';}).join("");
    box.innerHTML='<h2>Users</h2><p><input id="invemail" type="email" placeholder="friend@example.com"> <button id="invbtn" class="blue">Invite</button></p><p id="invmsg" class="muted"></p><ul class="allow">'+rows+'</ul>';
  });
}
```

with:

```javascript
function loadInvite(){
  var box=document.getElementById("users");
  fetch("/api/allowlist").then(function(r){return r.ok?r.json():{emails:[]};}).then(function(d){
    var rows=(d.emails||[]).map(function(e){return '<li><span>'+esc(e)+'</span><input type="checkbox" class="usel" value="'+esc(e)+'"></li>';}).join("");
    box.innerHTML='<h2>Users</h2><p><input id="invemail" type="email" placeholder="friend@example.com"> <button id="invbtn" class="blue">Invite</button></p><p id="invmsg" class="muted"></p><ul class="allow">'+rows+'</ul><p><button id="rmsel">Remove selected</button></p>';
  });
}
```

Replace the `rmAllow` function:

```javascript
function rmAllow(email){fetch("/api/allowlist/remove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email})}).then(loadInvite);}
```

with:

```javascript
function removeSelected(){
  var boxes=document.querySelectorAll("input.usel:checked");
  if(!boxes.length) return;
  if(!confirm("Remove "+boxes.length+" user(s)?")) return;
  var emails=[]; for(var i=0;i<boxes.length;i++) emails.push(boxes[i].value);
  Promise.all(emails.map(function(em){
    return fetch("/api/allowlist/remove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em})});
  })).then(loadInvite);
}
```

Replace the `#users` delegation handler:

```javascript
document.getElementById("users").addEventListener("click",function(e){
  if(e.target.id==="invbtn")invite();
  var rm=e.target.closest("button[data-rm]"); if(rm)rmAllow(rm.getAttribute("data-rm"));
});
```

with:

```javascript
document.getElementById("users").addEventListener("click",function(e){
  if(e.target.id==="invbtn")invite();
  if(e.target.id==="rmsel")removeSelected();
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run (from `worker/`): `npm test`
Expected: PASS (the new adminPage refinement test + the existing adminPage test — which still finds "Users" and "/api/allowlist" — + the full suite; the `not.toContain("onclick=")` regression still holds).

- [ ] **Step 7: Commit**

```bash
git add worker/src/pages.mjs worker/test/pages.test.mjs
git commit -m "feat: admin course Lessons column + checkbox user list with Remove selected

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Post-implementation (owner-operated)

After merge, redeploy the worker so `/admin` shows the refinements:

```bash
cd worker && npm run deploy
```

(No migration; the change is worker-only.)

---

## Self-Review

**Spec coverage** (against `2026-06-24-admin-list-refinements-design.md`):
- `adminStats` adds `lessons` = delivered count, 0 when absent, no email leak → Task 1. ✓
- Course list Lessons column → Task 2 (render header + cell). ✓
- User list right-aligned checkboxes + single "Remove selected" looping the existing endpoint, with confirm → Task 2 (`loadInvite` + `removeSelected` + delegation + CSS). ✓
- Owner self-removal stays blocked server-side (no client change needed) → unchanged route; noted. ✓
- "Active courses" already shown → no task (correctly omitted). ✓
- No inline `onclick`; escaping → Task 2 (assertion + `esc`). ✓
- Tests (adminStats lessons; adminPage column/checkbox/remove) → Tasks 1, 2. ✓

**Placeholder scan:** none — every code step shows complete before/after code; every test step shows full test code.

**Type consistency:** `adminStats` `courses[].lessons` (Task 1) is consumed by `render()`'s `esc(c.lessons)` and the test's `byTopic` (Task 1 test) and the column cell (Task 2). `removeSelected()` reads `input.usel:checked` (defined in `loadInvite`'s checkbox `class="usel"`) — names match. The `#rmsel` button id (loadInvite) matches the delegation branch (`e.target.id==="rmsel"`). The `input[type=checkbox]{width:auto}` override pairs with the existing global `input{width:100%}`. Consistent. ✓
