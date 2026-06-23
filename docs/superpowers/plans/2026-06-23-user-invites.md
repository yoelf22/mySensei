# User Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any signed-in user invite others, capped at 5 invites for non-owners (owner unlimited), tracked by a new `allowlist.invited_by` column.

**Architecture:** A migration adds `invited_by` to `allowlist`. `addToAllowlist` records the inviter and reports whether a new row was actually inserted (so a duplicate doesn't burn quota); `countInvitesBy` counts a user's invited rows. The `/api/invite` route drops its `isOwner` gate and enforces the quota for non-owners; `/api/courses` returns each user's `inviteRemaining`. The dashboard shows an invite panel to everyone — the owner keeps the full allowlist list + remove; a non-owner sees only an invite box and "N of 5 invites left".

**Tech Stack:** Cloudflare Worker + D1; vitest + `cloudflare:test` (`cd worker && npm test`). All changed files are under `worker/`.

## Global Constraints

- **Worker tests only:** every test in this plan runs via vitest + `cloudflare:test` — `cd worker && npm test`. NOT node:test. The harness auto-applies `worker/migrations/*`, so a new migration file is available to tests with no manual step.
- **Invite quota = 5** for non-owners; the owner (`isOwner(email, env)`, i.e. `email === env.OWNER_EMAIL`, case-insensitive) is **unlimited**. Use a single module-scope constant `INVITE_QUOTA = 5` in `worker.mjs`.
- **A duplicate invite must not consume quota:** inviting an already-allowlisted email is a no-op (`inserted: false`), sends no email, decrements nothing.
- **The full allowlist list (`GET /api/allowlist`) and remove (`POST /api/allowlist/remove`) stay owner-only.** A non-owner must never receive the list of other members.
- **Emails are normalized** (trim + lowercase) — follow the existing `norm()` in `db.mjs` and the route's existing `.trim().toLowerCase()`.
- **Commits:** small, one per task, on a feature branch off `main`. End commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `worker/migrations/0004_invited_by.sql` | Add `invited_by` to `allowlist` | **Create** |
| `worker/src/db.mjs` | D1 access; `addToAllowlist` records inviter + reports insertion; new `countInvitesBy` | **Modify** |
| `worker/test/db.test.mjs` | db tests | **Modify** (add cases) |
| `worker/src/worker.mjs` | `/api/invite` ungated + quota; `/api/courses` `inviteRemaining`; `INVITE_QUOTA` | **Modify** |
| `worker/test/owner.test.mjs` | route tests | **Modify** (update the now-wrong 403 case; add quota cases) |
| `worker/src/pages.mjs` | Dashboard: invite panel for everyone; non-owner lighter panel | **Modify** |
| `worker/test/pages.test.mjs` | dashboard HTML tests | **Modify** (update invite-panel assertions) |

---

## Task 1: `invited_by` column + db functions

**Files:**
- Create: `worker/migrations/0004_invited_by.sql`
- Modify: `worker/src/db.mjs`
- Test: `worker/test/db.test.mjs`

**Interfaces:**
- Consumes: `env.DB`, `now()`, `norm()` (already in `db.mjs`).
- Produces:
  - `addToAllowlist(env, email, invitedBy = null) => { inserted: boolean }` — inserts the row recording `invited_by` (normalized, or `NULL` when omitted); `inserted` is `true` only when a new row was added (D1 `meta.changes === 1`), `false` when the email was already present.
  - `countInvitesBy(env, email) => number` — count of allowlist rows whose `invited_by` equals the normalized email.

- [ ] **Step 1: Create the migration**

Create `worker/migrations/0004_invited_by.sql`:

```sql
-- Track who invited each allowlisted user, to enforce a per-user invite quota.
-- Pre-existing (owner-seeded) rows keep invited_by NULL.
ALTER TABLE allowlist ADD COLUMN invited_by TEXT;
```

- [ ] **Step 2: Write the failing tests**

Append to `worker/test/db.test.mjs` (it already imports from `../src/db.mjs` and clears tables in a `beforeEach`; add `addToAllowlist, countInvitesBy` to that import if not present, and add this block):

```javascript
import { addToAllowlist, countInvitesBy, listAllowlist } from "../src/db.mjs";

describe("invite quota tracking", () => {
  beforeEach(async () => { await env.DB.exec("DELETE FROM allowlist;"); });

  it("addToAllowlist reports a fresh insert and records the inviter", async () => {
    const r = await addToAllowlist(env, "Friend@Y.com", "Me@X.com");
    expect(r.inserted).toBe(true);
    expect(await listAllowlist(env)).toContain("friend@y.com");
    expect(await countInvitesBy(env, "me@x.com")).toBe(1);
  });

  it("addToAllowlist on an existing email is not a fresh insert", async () => {
    await addToAllowlist(env, "dup@y.com", "me@x.com");
    const again = await addToAllowlist(env, "dup@y.com", "someone-else@x.com");
    expect(again.inserted).toBe(false);
    // the inviter is not overwritten, and no second invite is counted
    expect(await countInvitesBy(env, "me@x.com")).toBe(1);
    expect(await countInvitesBy(env, "someone-else@x.com")).toBe(0);
  });

  it("addToAllowlist without an inviter stores NULL and counts for no one", async () => {
    const r = await addToAllowlist(env, "seed@y.com");
    expect(r.inserted).toBe(true);
    expect(await countInvitesBy(env, "")).toBe(0);
  });

  it("countInvitesBy counts only that user's invited rows", async () => {
    await addToAllowlist(env, "a@y.com", "me@x.com");
    await addToAllowlist(env, "b@y.com", "me@x.com");
    await addToAllowlist(env, "c@y.com", "other@x.com");
    expect(await countInvitesBy(env, "me@x.com")).toBe(2);
    expect(await countInvitesBy(env, "other@x.com")).toBe(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — `countInvitesBy is not a function`, and/or `addToAllowlist` returns `undefined` (so `r.inserted` throws).

- [ ] **Step 4: Implement the db changes**

In `worker/src/db.mjs`, replace the existing `addToAllowlist`:

```javascript
export async function addToAllowlist(env, email) {
  await env.DB.prepare("INSERT OR IGNORE INTO allowlist(email, added_at) VALUES(?, ?)").bind(norm(email), now()).run();
}
```

with:

```javascript
export async function addToAllowlist(env, email, invitedBy = null) {
  const res = await env.DB.prepare(
    "INSERT OR IGNORE INTO allowlist(email, added_at, invited_by) VALUES(?, ?, ?)",
  ).bind(norm(email), now(), invitedBy ? norm(invitedBy) : null).run();
  return { inserted: res.meta.changes === 1 };
}

export async function countInvitesBy(env, email) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM allowlist WHERE invited_by = ?",
  ).bind(norm(email)).first();
  return row.n;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS — the 4 new quota-tracking tests, plus all existing worker tests still green (the `addToAllowlist` change is additive: a new optional param + a return value existing callers ignored).

- [ ] **Step 6: Commit**

```bash
git add worker/migrations/0004_invited_by.sql worker/src/db.mjs worker/test/db.test.mjs
git commit -m "feat: allowlist.invited_by + countInvitesBy for invite quotas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `/api/invite` ungated with a quota; `/api/courses` returns `inviteRemaining`

**Files:**
- Modify: `worker/src/worker.mjs`
- Test: `worker/test/owner.test.mjs`

**Interfaces:**
- Consumes: `addToAllowlist(env, email, invitedBy) => { inserted }`, `countInvitesBy(env, email) => number` (Task 1); existing `sessionEmail`, `isOwner`, `sendInvite`, `listCourses`.
- Produces:
  - `POST /api/invite`: any signed-in user; non-owner capped at `INVITE_QUOTA`; returns `{ ok, email, already, remaining }` (`remaining` is `null` for the owner).
  - `GET /api/courses`: response gains `inviteRemaining` (`number` for non-owner, `null` for owner) alongside the existing `isOwner`.

- [ ] **Step 1: Update + add the route tests**

In `worker/test/owner.test.mjs`:

(a) **Replace** the existing test that asserts a non-owner gets 403 from `/api/invite` — that behavior is intentionally changing. Find:

```javascript
  it("invite/allowlist are 403 for a non-owner", async () => {
    expect((await call("/api/invite", { method: "POST", headers: await jh("nobody@x.com"), body: JSON.stringify({ email: "x@y.com" }) })).status).toBe(403);
    expect((await call("/api/allowlist", { headers: await jh("nobody@x.com") })).status).toBe(403);
  });
```

and replace it with:

```javascript
  it("allowlist list stays 403 for a non-owner", async () => {
    expect((await call("/api/allowlist", { headers: await jh("nobody@x.com") })).status).toBe(403);
    expect((await call("/api/allowlist/remove", { method: "POST", headers: await jh("nobody@x.com"), body: JSON.stringify({ email: "x@y.com" }) })).status).toBe(403);
  });
```

(b) **Append** these new tests inside the `describe("owner tooling", ...)` block:

```javascript
  it("a non-owner can invite within a quota of 5, then is refused", async () => {
    const u = await jh("user@x.com");
    for (let i = 1; i <= 5; i++) {
      const res = await call("/api/invite", { method: "POST", headers: u, body: JSON.stringify({ email: `g${i}@y.com` }) });
      expect(res.status).toBe(200);
      expect((await res.json()).remaining).toBe(5 - i);
    }
    const sixth = await call("/api/invite", { method: "POST", headers: u, body: JSON.stringify({ email: "g6@y.com" }) });
    expect(sixth.status).toBe(403);
    expect((await sixth.json()).error).toBe("no invites left");
  });

  it("the owner can invite past 5 with remaining null", async () => {
    const o = await jh(OWNER);
    for (let i = 1; i <= 6; i++) {
      const res = await call("/api/invite", { method: "POST", headers: o, body: JSON.stringify({ email: `o${i}@y.com` }) });
      expect(res.status).toBe(200);
      expect((await res.json()).remaining).toBe(null);
    }
  });

  it("re-inviting an already-allowlisted email does not consume quota", async () => {
    const u = await jh("user@x.com");
    await call("/api/invite", { method: "POST", headers: u, body: JSON.stringify({ email: "same@y.com" }) });
    const again = await call("/api/invite", { method: "POST", headers: u, body: JSON.stringify({ email: "same@y.com" }) });
    const body = await again.json();
    expect(again.status).toBe(200);
    expect(body.already).toBe(true);
    expect(body.remaining).toBe(4); // still only one invite spent
  });

  it("/api/courses reports inviteRemaining (number for a user, null for the owner)", async () => {
    expect((await (await call("/api/courses", { headers: await jh(OWNER) })).json()).inviteRemaining).toBe(null);
    expect((await (await call("/api/courses", { headers: await jh("fresh@x.com") })).json()).inviteRemaining).toBe(5);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — the non-owner invite currently 403s (new tests expect 200), and `inviteRemaining`/`remaining` are `undefined`.

- [ ] **Step 3: Add the constant and the imports**

In `worker/src/worker.mjs`, extend the existing `./db.mjs` import (line 2) to add `countInvitesBy`:

```javascript
import { isAllowlisted, createCourse, listCourses, getCourse, setStatus, countActive, getPage, courseToCurriculum, addToAllowlist, listAllowlist, removeFromAllowlist, createDispute, countInvitesBy } from "./db.mjs";
```

Add a module-scope constant near the top of the file (just below the `CORS` constant):

```javascript
const INVITE_QUOTA = 5;
```

- [ ] **Step 4: Rewrite the `/api/invite` route**

Replace the existing block:

```javascript
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
```

with:

```javascript
    if (pathname === "/api/invite" && method === "POST") {
      const email = await sessionEmail(request, env);
      if (!email) return json({ error: "unauthorized" }, 401);
      let body; try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
      const invitee = String(body.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invitee)) return json({ error: "invalid email" }, 400);
      const owner = isOwner(email, env);
      if (!owner && (await countInvitesBy(env, email)) >= INVITE_QUOTA) return json({ error: "no invites left" }, 403);
      const { inserted } = await addToAllowlist(env, invitee, email);
      if (inserted) await sendInvite(env, invitee);
      const remaining = owner ? null : INVITE_QUOTA - (await countInvitesBy(env, email));
      return json({ ok: true, email: invitee, already: !inserted, remaining });
    }
```

- [ ] **Step 5: Add `inviteRemaining` to `GET /api/courses`**

In the `/api/courses` block, replace the GET line:

```javascript
      if (method === "GET") return json({ courses: await listCourses(env, email), isOwner: isOwner(email, env) });
```

with:

```javascript
      if (method === "GET") {
        const owner = isOwner(email, env);
        const inviteRemaining = owner ? null : INVITE_QUOTA - (await countInvitesBy(env, email));
        return json({ courses: await listCourses(env, email), isOwner: owner, inviteRemaining });
      }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS — all new invite/quota tests plus the full existing worker suite. (The owner-invite test in this file still passes: the owner path still allowlists and dispatches; it now also returns `remaining: null`.)

- [ ] **Step 7: Commit**

```bash
git add worker/src/worker.mjs worker/test/owner.test.mjs
git commit -m "feat: any user can invite (quota 5); /api/courses returns inviteRemaining

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Dashboard invite panel for every user

**Files:**
- Modify: `worker/src/pages.mjs`
- Test: `worker/test/pages.test.mjs`

**Interfaces:**
- Consumes: the `/api/courses` response now carrying `inviteRemaining` and `isOwner` (Task 2); the `/api/invite` response `{ ok, already, remaining }` (Task 2).
- Produces: a dashboard where the `#invite` panel is shown to everyone. Owner → existing list + remove (`loadInvite()`). Non-owner → `renderInvitePanel(remaining)`: an invite box + "N of 5 invites left", no list, no remove, no `/api/allowlist` call.

- [ ] **Step 1: Update the dashboard test**

In `worker/test/pages.test.mjs`, replace the existing test:

```javascript
it("dashboard has an owner-gated invite panel and a failure badge", async () => {
  const html = await (await get("/dashboard")).text();
  expect(html).toContain("d.isOwner");          // invite UI gated on owner
  expect(html).toContain("/api/invite");
  expect(html).toContain("/api/allowlist");
  expect(html).toContain("c.last_error");        // badge driven by last_error
  expect(html).toContain("delayed");
});
```

with:

```javascript
it("dashboard shows an invite panel to everyone; the allowlist list stays owner-only", async () => {
  const html = await (await get("/dashboard")).text();
  expect(html).toContain("renderInvitePanel");   // non-owner lighter panel
  expect(html).toContain("of 5 invites left");   // remaining line
  expect(html).toContain("d.isOwner");           // owner branch → loadInvite (list)
  expect(html).toContain("/api/invite");
  expect(html).toContain("/api/allowlist");      // owner-only list, inside loadInvite
  expect(html).toContain("c.last_error");        // badge driven by last_error
  expect(html).toContain("delayed");
  expect(html).not.toContain("onclick=");        // still delegation, no fragile inline handlers
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `worker/`): `npm test`
Expected: FAIL — `renderInvitePanel` and `of 5 invites left` are not yet in the dashboard HTML.

- [ ] **Step 3: Implement the dashboard changes**

In `worker/src/pages.mjs`, inside `dashboardPage()`'s inline `<script>`:

(a) Add a module-level flag right after the `esc` function definition (the line starting `function esc(s){...}`), on its own line:

```javascript
var IS_OWNER=false;
```

(b) Add a `renderInvitePanel` function — place it immediately before the existing `function invite(){`:

```javascript
function renderInvitePanel(remaining){
  var box=document.getElementById("invite"); box.style.display="block";
  box.innerHTML='<h2>Invite</h2><p class="muted" id="invleft">'+esc(remaining)+' of 5 invites left</p><p><input id="invemail" type="email" placeholder="friend@example.com"> <button id="invbtn">Invite</button></p><p id="invmsg" class="muted"></p>';
}
```

(c) Replace the existing `invite()` function:

```javascript
function invite(){
  var em=document.getElementById("invemail").value, msg=document.getElementById("invmsg");
  fetch("/api/invite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em})})
    .then(function(r){msg.textContent=r.ok?("Invited "+em):"Could not invite (check the address).";if(r.ok)loadInvite();});
}
```

with:

```javascript
function invite(){
  var em=document.getElementById("invemail").value, msg=document.getElementById("invmsg");
  fetch("/api/invite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em})})
    .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
    .then(function(res){
      if(!res.ok){msg.textContent=(res.d&&res.d.error==="no invites left")?"You're out of invites.":"Could not invite (check the address).";return;}
      msg.textContent=res.d.already?(em+" is already invited."):("Invited "+em);
      if(IS_OWNER){loadInvite();}
      else{var left=document.getElementById("invleft");if(left&&res.d.remaining!=null){left.textContent=res.d.remaining+" of 5 invites left";}}
    });
}
```

(d) In `load()`, replace the line:

```javascript
  if(d.isOwner) loadInvite();
```

with:

```javascript
  IS_OWNER=!!d.isOwner;
  if(d.isOwner) loadInvite(); else renderInvitePanel(d.inviteRemaining);
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `worker/`): `npm test`
Expected: PASS — the updated invite-panel test and the full existing worker suite (the course-delegation regression test still passes: no `onclick=`, `esc(` still present, `addEventListener("click"` unchanged).

- [ ] **Step 5: Commit**

```bash
git add worker/src/pages.mjs worker/test/pages.test.mjs
git commit -m "feat: dashboard invite panel for every user (non-owner sees remaining)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Post-implementation (owner-operated)

After all tasks merge, the feature needs the migration applied and the worker redeployed (same as the dispute feature):

```bash
cd worker && npx wrangler d1 migrations apply mysensei --remote
npm run deploy
```

Then a quick live check: sign in as a non-owner, confirm the dashboard shows "5 of 5 invites left" and an invite box (no member list), invite someone, and confirm the count drops to 4 and the invitee gets a sign-in email.

---

## Self-Review

**Spec coverage** (against `2026-06-23-user-invites-design.md`):
- Every signed-in user can invite; `isOwner` gate removed → Task 2. ✓
- Non-owner quota of 5, owner unlimited → Task 2 (`INVITE_QUOTA`, the `owner ?` branches). ✓
- Quota tracked by `invited_by` → Task 1 (migration + `countInvitesBy`). ✓
- Already-allowlisted = no-op, no quota charge → Task 1 (`inserted`) + Task 2 (`already`, no `sendInvite`, `remaining` unchanged) + test. ✓
- Full list + remove stay owner-only → unchanged routes; Task 2 test asserts non-owner 403; Task 3 keeps `/api/allowlist` only in the owner `loadInvite` path. ✓
- `/api/courses` gains `inviteRemaining` → Task 2. ✓
- Dashboard: panel for everyone; non-owner lighter panel with remaining, no list → Task 3. ✓
- Chaining: an invited user is just a normal signed-in user, so they get their own quota with no special-casing — satisfied by Task 2 applying the quota to every non-owner. ✓
- Error handling: invalid email 400 (kept), quota exhausted 403, unauthenticated 401 (kept), self/owner invite no-op (already allowlisted) → Tasks 2/1. ✓
- Testing matrix (db, routes, pages) → Tasks 1/2/3 carry exactly those tests. ✓

**Placeholder scan:** none — every code step shows complete before/after code; every test step shows full test code.

**Type consistency:** `addToAllowlist(env, email, invitedBy=null) => { inserted }` — defined Task 1, called Task 2 (`const { inserted } = await addToAllowlist(env, invitee, email)`). `countInvitesBy(env, email) => number` — defined Task 1, called Task 2 in three places (`/api/invite` guard, `/api/invite` remaining, `/api/courses`). Route response `{ ok, email, already, remaining }` — produced Task 2, consumed by Task 3's `invite()` (`res.d.already`, `res.d.remaining`). `/api/courses` `inviteRemaining` — produced Task 2, consumed by Task 3's `load()` (`d.inviteRemaining`). `INVITE_QUOTA = 5` consistent with the literal `5` and "of 5 invites left" copy across tasks. Consistent. ✓
