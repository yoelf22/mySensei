# Course Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a learner share a course as an auto-allow link that drops a new person into onboarding with subject + angle pre-filled, capped at 10 acceptances, with a use consumed only on a verified sign-in.

**Architecture:** A `shares` table holds a snapshot (subject, angle, max_uses, uses). A learner mints a link via `POST /api/courses/:id/share`. `GET /share/:token` either accepts a signed-in user immediately or shows a landing page; for a new person the magic-link sign-in carries the share token (a new `magic_tokens.share_token` column), and on `/auth/verify` the system atomically claims a use, allowlists the email, creates the recipient's preset draft course, and redirects to the prefilled onboarding form.

**Tech Stack:** Cloudflare Worker + D1 (vitest + `cloudflare:test`, `cd worker && npm test`); plus one pure lib renderer in `lib/render-onboard.mjs` (node:test).

## Global Constraints

- **Worker tests** run via vitest + `cloudflare:test` (`cd worker && npm test`); migrations auto-apply from `worker/migrations/`. The one lib change (`lib/render-onboard.mjs`) is tested with `node --test lib/render-onboard.test.mjs`; the repo's root `npm test` also collects `worker/test/*` which can't load under node:test (pre-existing `ERR_UNSUPPORTED_ESM_URL_SCHEME`) — not in scope.
- **`max_uses = 10`** per link (default in `createShare`). The use count must be claimed **atomically** (`UPDATE ... WHERE uses < max_uses`) so concurrent accepts never exceed it.
- **A use is consumed and the email allowlisted only at `/auth/verify`** (verified sign-in) — never at link-open or at `/auth/request`. The already-signed-in `GET /share/:token` path claims the use directly.
- **Sharing does not touch the 5-invite quota.** Recipients are allowlisted with `invited_by = 'share'`.
- **Carry only subject + angle.** Snapshot them into the `shares` row at mint time; the recipient sets their own language/level/cadence and runs their own placement.
- **No user enumeration:** `/auth/request` always returns `{ ok: true }`.
- **Dashboard inline JS:** plain ES5 + event delegation, **no `onclick=`** (a regression test guards this), HTML-escape interpolated values with the existing `esc()`.
- **Commits:** small, one per task, on a feature branch off `main`. End messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `worker/migrations/0005_shares.sql` | `shares` table + `magic_tokens.share_token` | **Create** |
| `worker/src/db.mjs` | `createShare`/`getShare`/`claimShareUse`; extend `createCourse` with subject+angle | **Modify** |
| `worker/test/db.test.mjs` | db tests | **Modify** |
| `worker/src/auth.mjs` | `mintToken` carries a share token; `consumeToken` returns `{ email, shareToken }` | **Modify** |
| `worker/test/auth.test.mjs` | auth tests (return-shape change) | **Modify** |
| `lib/render-onboard.mjs` | onboarding form prefilled with subject + angle | **Modify** |
| `lib/render-onboard.test.mjs` | renderer tests | **Modify** |
| `worker/src/pages.mjs` | share landing + unavailable pages; dashboard Share control | **Modify** |
| `worker/src/worker.mjs` | `POST /api/courses/:id/share`; `GET /share/:token`; `/auth/request` + `/auth/verify` share handling; onboard-route prefill | **Modify** |
| `worker/test/share.test.mjs` | share endpoint + accept-flow tests | **Create** |
| `worker/test/pages.test.mjs` | dashboard Share control assertion | **Modify** |

---

## Task 1: `shares` table + db functions

**Files:**
- Create: `worker/migrations/0005_shares.sql`
- Modify: `worker/src/db.mjs`
- Test: `worker/test/db.test.mjs`

**Interfaces:**
- Consumes: `env.DB`, `now()`, `randomId()`, `norm()` (in `db.mjs`).
- Produces:
  - `createShare(env, { subject, angle, createdBy, maxUses = 10 }) => { token }` — `token = randomId(24)`; `angle` stored as `null` when falsy.
  - `getShare(env, token) => row | null` (columns: `token, subject, angle, max_uses, uses, created_by, created_at`).
  - `claimShareUse(env, token) => boolean` — atomic `UPDATE shares SET uses = uses + 1 WHERE token = ? AND uses < max_uses`; `true` iff `meta.changes === 1`.
  - `createCourse(env, ownerEmail, subject = null, angle = null) => { id }` — now also writes `subject`/`angle` on the draft (additive; existing 2-arg callers still create a bare draft).

- [ ] **Step 1: Create the migration**

Create `worker/migrations/0005_shares.sql`:

```sql
-- A shareable link to start a copy of a course. subject+angle are snapshotted
-- at mint time; max_uses caps acceptances (a use is claimed atomically).
CREATE TABLE shares (
  token TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  angle TEXT,
  max_uses INTEGER NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- Carries share intent through the magic-link round-trip; NULL for normal sign-ins.
ALTER TABLE magic_tokens ADD COLUMN share_token TEXT;
```

- [ ] **Step 2: Write the failing tests**

Append to `worker/test/db.test.mjs` (extend its `../src/db.mjs` import with `createShare, getShare, claimShareUse, createCourse, getCourse`):

```javascript
describe("course sharing db", () => {
  beforeEach(async () => { await env.DB.exec("DELETE FROM shares; DELETE FROM courses;"); });

  it("createShare + getShare round-trip", async () => {
    const { token } = await createShare(env, { subject: "Chess", angle: "for clubs", createdBy: "Me@X.com" });
    const row = await getShare(env, token);
    expect(row.subject).toBe("Chess");
    expect(row.angle).toBe("for clubs");
    expect(row.max_uses).toBe(10);
    expect(row.uses).toBe(0);
    expect(row.created_by).toBe("me@x.com");
  });

  it("claimShareUse is atomic and stops at max_uses", async () => {
    const { token } = await createShare(env, { subject: "X", angle: "", createdBy: "a@x.com", maxUses: 2 });
    expect(await claimShareUse(env, token)).toBe(true);
    expect(await claimShareUse(env, token)).toBe(true);
    expect(await claimShareUse(env, token)).toBe(false);
    expect((await getShare(env, token)).uses).toBe(2);
    expect(await claimShareUse(env, "nope")).toBe(false);
  });

  it("createCourse can preset subject + angle", async () => {
    const { id } = await createCourse(env, "u@x.com", "Chess", "for clubs");
    const c = await getCourse(env, id);
    expect(c.subject).toBe("Chess");
    expect(c.angle).toBe("for clubs");
    expect(c.status).toBe("draft");
    const bare = await getCourse(env, (await createCourse(env, "u@x.com")).id);
    expect(bare.subject == null || bare.subject === "").toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — `createShare is not a function`; `createCourse` ignores the extra args.

- [ ] **Step 4: Implement the db changes**

In `worker/src/db.mjs`, replace `createCourse`:

```javascript
export async function createCourse(env, ownerEmail) {
  const id = randomId();
  const t = now();
  await env.DB.prepare(
    "INSERT INTO courses(id, owner_email, status, created_at, updated_at) VALUES(?,?,?,?,?)",
  ).bind(id, norm(ownerEmail), "draft", t, t).run();
  return { id };
}
```

with:

```javascript
export async function createCourse(env, ownerEmail, subject = null, angle = null) {
  const id = randomId();
  const t = now();
  await env.DB.prepare(
    "INSERT INTO courses(id, owner_email, status, subject, angle, created_at, updated_at) VALUES(?,?,?,?,?,?,?)",
  ).bind(id, norm(ownerEmail), "draft", subject, angle, t, t).run();
  return { id };
}
```

Append the share functions:

```javascript
export async function createShare(env, { subject, angle, createdBy, maxUses = 10 }) {
  const token = randomId(24);
  await env.DB.prepare(
    "INSERT INTO shares(token, subject, angle, max_uses, uses, created_by, created_at) VALUES(?,?,?,?,0,?,?)",
  ).bind(token, subject, angle || null, maxUses, norm(createdBy), now()).run();
  return { token };
}

export async function getShare(env, token) {
  return env.DB.prepare("SELECT * FROM shares WHERE token = ?").bind(token).first();
}

export async function claimShareUse(env, token) {
  const res = await env.DB.prepare(
    "UPDATE shares SET uses = uses + 1 WHERE token = ? AND uses < max_uses",
  ).bind(token).run();
  return res.meta.changes === 1;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS — the 3 new sharing-db tests plus the full existing suite (the `createCourse` change is additive).

- [ ] **Step 6: Commit**

```bash
git add worker/migrations/0005_shares.sql worker/src/db.mjs worker/test/db.test.mjs
git commit -m "feat: shares table + createShare/getShare/claimShareUse; createCourse presets subject

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Magic-link carries the share token

**Files:**
- Modify: `worker/src/auth.mjs`
- Modify: `worker/src/worker.mjs` (only the `/auth/verify` caller, to match the new return shape)
- Test: `worker/test/auth.test.mjs`

**Interfaces:**
- Consumes: `randomId`, `now` (from `db.mjs`); the `magic_tokens.share_token` column (Task 1).
- Produces:
  - `mintToken(env, email, shareToken = null) => token` — stores `share_token` (additive optional param).
  - `consumeToken(env, token) => { email, shareToken } | null` — return shape changes from a bare string to an object; keeps the atomic single-use guard.

- [ ] **Step 1: Update + add the auth tests**

In `worker/test/auth.test.mjs`, replace the "magic token is single-use" test body's assertions and add a share-token test:

```javascript
  it("magic token is single-use and expires", async () => {
    const tok = await mintToken(env, "me@x.com");
    expect(await consumeToken(env, tok)).toEqual({ email: "me@x.com", shareToken: null });
    expect(await consumeToken(env, tok)).toBe(null); // already used
    expect(await consumeToken(env, "bogus")).toBe(null);
  });
  it("magic token carries an optional share token", async () => {
    const tok = await mintToken(env, "a@x.com", "sharetok1");
    expect(await consumeToken(env, tok)).toEqual({ email: "a@x.com", shareToken: "sharetok1" });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — `consumeToken` returns the string `"me@x.com"`, not the object; the share-token test fails too.

- [ ] **Step 3: Implement the auth changes**

In `worker/src/auth.mjs`, replace `mintToken` and `consumeToken`:

```javascript
export async function mintToken(env, email, shareToken = null) {
  const token = randomId(24);
  const expires = new Date(Date.now() + TOKEN_MIN * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO magic_tokens(token, email, expires_at, used, share_token) VALUES(?,?,?,0,?)")
    .bind(token, String(email).trim().toLowerCase(), expires, shareToken).run();
  return token;
}

export async function consumeToken(env, token) {
  const row = await env.DB.prepare("SELECT email, expires_at, share_token FROM magic_tokens WHERE token = ?").bind(token).first();
  if (!row || row.expires_at < now()) return null;
  const result = await env.DB.prepare("UPDATE magic_tokens SET used = 1 WHERE token = ? AND used = 0").bind(token).run();
  if (result.meta.changes === 0) return null;
  return { email: row.email, shareToken: row.share_token || null };
}
```

- [ ] **Step 4: Update the one `consumeToken` caller in `worker.mjs`**

In the `POST /auth/verify` block, replace:

```javascript
    if (method === "POST" && pathname === "/auth/verify") {
      const form = await request.formData();
      const email = await consumeToken(env, String(form.get("token") || ""));
      if (!email) return new Response("This link is invalid or expired. Request a new one.", { status: 400 });
      const cookie = sessionCookie(await signSession(email, env.SESSION_SECRET));
      return new Response(null, { status: 302, headers: { Location: "/dashboard", "Set-Cookie": cookie } });
    }
```

with (destructure the new shape; the share branch is added in Task 6):

```javascript
    if (method === "POST" && pathname === "/auth/verify") {
      const form = await request.formData();
      const consumed = await consumeToken(env, String(form.get("token") || ""));
      if (!consumed) return new Response("This link is invalid or expired. Request a new one.", { status: 400 });
      const { email } = consumed;
      const cookie = sessionCookie(await signSession(email, env.SESSION_SECRET));
      return new Response(null, { status: 302, headers: { Location: "/dashboard", "Set-Cookie": cookie } });
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS — auth tests plus the full worker suite (verify still round-trips: existing verify-path tests in `verify.test.mjs`/`routes.test.mjs` see the same 302 + cookie).

- [ ] **Step 6: Commit**

```bash
git add worker/src/auth.mjs worker/src/worker.mjs worker/test/auth.test.mjs
git commit -m "feat: magic token carries an optional share token; consumeToken returns {email, shareToken}

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Onboarding form prefill

**Files:**
- Modify: `lib/render-onboard.mjs`
- Test: `lib/render-onboard.test.mjs`

**Interfaces:**
- Consumes: `escapeHtml` (already imported in `render-onboard.mjs`).
- Produces: `renderOnboardHtml({ webhookUrl, courseId, subject = "", angle = "" })` — the subject `<textarea>` and angle `<input>` render with the (escaped) prefilled values; empty by default. The submit JS reads the form fields via `FormData`, so no JS change is needed — prefilled values flow through automatically.

- [ ] **Step 1: Write the failing test**

Append to `lib/render-onboard.test.mjs` (it imports `renderOnboardHtml` and uses `node:test`):

```javascript
test("renderOnboardHtml prefills subject and angle when given", () => {
  const html = renderOnboardHtml({ webhookUrl: "https://app/submit", courseId: "c1", subject: "Chess <openings>", angle: "for clubs" });
  assert.match(html, /Chess &lt;openings&gt;<\/textarea>/);     // subject prefilled + escaped
  assert.match(html, /name="angle"[^>]*value="for clubs"/);     // angle prefilled
});

test("renderOnboardHtml has empty subject/angle by default", () => {
  const html = renderOnboardHtml({ webhookUrl: "https://app/submit", courseId: "c1" });
  assert.match(html, /name="subject" required placeholder="[^"]*"><\/textarea>/); // empty textarea
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test lib/render-onboard.test.mjs`
Expected: FAIL — the textarea is always empty; no `value` on the angle input.

- [ ] **Step 3: Implement the prefill**

In `lib/render-onboard.mjs`, change the signature and add escaped locals:

```javascript
export function renderOnboardHtml({ webhookUrl, courseId, subject = "", angle = "" }) {
  const hook = escapeHtml(webhookUrl || "");
  const subj = escapeHtml(subject || "");
  const ang = escapeHtml(angle || "");
```

Change the subject and angle fields:

```javascript
    <label>Subject<textarea name="subject" required placeholder="A topic, a question, or a goal — in your own words">${subj}</textarea></label>
    <label>Any particular angle or goal? <span class="hint">(optional)</span><input type="text" name="angle" value="${ang}" placeholder="e.g. master a concept, prepare for an exam, or deepen a skill"></label>
```

(Leave the rest of the form and the submit JS unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test lib/render-onboard.test.mjs`
Expected: PASS (both new tests + existing render-onboard tests).

- [ ] **Step 5: Commit**

```bash
git add lib/render-onboard.mjs lib/render-onboard.test.mjs
git commit -m "feat: onboarding form prefills subject + angle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `POST /api/courses/:id/share` — mint a link

**Files:**
- Modify: `worker/src/worker.mjs`
- Test: `worker/test/share.test.mjs` (create)

**Interfaces:**
- Consumes: `sessionEmail`, `getCourse`, `createShare` (Task 1), `env.APP_BASE_URL`.
- Produces: `POST /api/courses/:id/share` → `{ ok: true, url }` for the course owner; 401 unauth; 404 non-owner/unknown; 400 when the course has no subject.

- [ ] **Step 1: Write the failing tests**

Create `worker/test/share.test.mjs`:

```javascript
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../src/worker.mjs";
import { signSession } from "../src/auth.mjs";
import { createCourse, getShare } from "../src/db.mjs";

const E = { ...env, SESSION_SECRET: "s", OWNER_EMAIL: "owner@x.com", GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r", APP_BASE_URL: "https://app" };
async function call(path, init) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://app" + path, init), E, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
async function cookie(email) { return "session=" + (await signSession(email, "s")); }
const jh = async (email) => ({ Cookie: await cookie(email), "Content-Type": "application/json" });

beforeEach(async () => {
  await env.DB.exec("DELETE FROM shares; DELETE FROM courses; DELETE FROM allowlist; DELETE FROM magic_tokens;");
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 }));
});

describe("POST /api/courses/:id/share", () => {
  it("owner mints a link to a course that has a subject", async () => {
    const { id } = await createCourse(env, "u@x.com", "Chess", "for clubs");
    const res = await call(`/api/courses/${id}/share`, { method: "POST", headers: await jh("u@x.com") });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toMatch(/^https:\/\/app\/share\/[a-z0-9]+$/);
    const token = body.url.split("/").pop();
    const share = await getShare(env, token);
    expect(share.subject).toBe("Chess");
    expect(share.created_by).toBe("u@x.com");
  });

  it("401 unauthenticated", async () => {
    const { id } = await createCourse(env, "u@x.com", "Chess", "x");
    expect((await call(`/api/courses/${id}/share`, { method: "POST" })).status).toBe(401);
  });

  it("404 for a non-owner or unknown course", async () => {
    const { id } = await createCourse(env, "u@x.com", "Chess", "x");
    expect((await call(`/api/courses/${id}/share`, { method: "POST", headers: await jh("other@x.com") })).status).toBe(404);
    expect((await call(`/api/courses/zzzznope12/share`, { method: "POST", headers: await jh("u@x.com") })).status).toBe(404);
  });

  it("400 for a bare draft with no subject", async () => {
    const { id } = await createCourse(env, "u@x.com");
    expect((await call(`/api/courses/${id}/share`, { method: "POST", headers: await jh("u@x.com") })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — the route 404s (not implemented), so the owner test sees 404 not 200.

- [ ] **Step 3: Implement the route**

In `worker/src/worker.mjs`, extend the `./db.mjs` import to add `createShare` (and `getShare`, `claimShareUse` — used in later tasks; add them now to keep the import stable):

```javascript
import { isAllowlisted, createCourse, listCourses, getCourse, setStatus, countActive, getPage, courseToCurriculum, addToAllowlist, listAllowlist, removeFromAllowlist, createDispute, countInvitesBy, createShare, getShare, claimShareUse } from "./db.mjs";
```

Add the route immediately after the `pause/resume` block (after its closing `}`):

```javascript
    const shareReq = pathname.match(/^\/api\/courses\/([a-z0-9]+)\/share$/);
    if (shareReq && method === "POST") {
      const email = await sessionEmail(request, env);
      if (!email) return json({ error: "unauthorized" }, 401);
      const course = await getCourse(env, shareReq[1]);
      if (!course || course.owner_email !== email) return json({ error: "not found" }, 404);
      if (!course.subject) return json({ error: "nothing to share yet" }, 400);
      const { token } = await createShare(env, { subject: course.subject, angle: course.angle || "", createdBy: email });
      return json({ ok: true, url: `${env.APP_BASE_URL}/share/${token}` });
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS (the 4 new share-endpoint tests + the full existing suite).

- [ ] **Step 5: Commit**

```bash
git add worker/src/worker.mjs worker/test/share.test.mjs
git commit -m "feat: POST /api/courses/:id/share mints an auto-allow share link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `GET /share/:token` — signed-in accept + landing pages + onboarding prefill

**Files:**
- Modify: `worker/src/pages.mjs`
- Modify: `worker/src/worker.mjs`
- Test: `worker/test/share.test.mjs` (extend)

**Interfaces:**
- Consumes: `getShare`, `claimShareUse`, `createCourse` (Tasks 1/4), `sessionEmail`, `renderOnboardHtml` prefill (Task 3).
- Produces:
  - `sharePage(subject, token) => html` (landing: shows subject, an email box, posts `{ email, shareToken: token }` to `/auth/request`).
  - `shareUnavailablePage() => html` ("this share link is no longer available").
  - `GET /share/:token`: invalid/full → unavailable page; signed-in → claim a use + create preset course + 302 to `/c/:id/onboard`; otherwise → landing page.
  - `/c/:id/onboard` now renders prefilled with the course's stored subject/angle.

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/share.test.mjs` (reuses the helpers + `beforeEach` above; add `createShare, claimShareUse` to the `db.mjs` import):

```javascript
import { createShare as mkShare, claimShareUse as claimUse } from "../src/db.mjs";

describe("GET /share/:token", () => {
  it("signed-in user: claims a use, creates a preset course, redirects to onboarding", async () => {
    const { token } = await mkShare(env, { subject: "Chess", angle: "for clubs", createdBy: "sharer@x.com" });
    const res = await call(`/share/${token}`, { headers: { Cookie: await cookie("rcpt@x.com") } });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toMatch(/^\/c\/[a-z0-9]+\/onboard$/);
    expect((await getShare(env, token)).uses).toBe(1);
  });

  it("unknown or full token shows the unavailable page", async () => {
    expect((await call(`/share/zzzznope12`, { headers: { Cookie: await cookie("rcpt@x.com") } })).status).toBe(200);
    const unknown = await call(`/share/zzzznope12`, {});
    expect(await unknown.text()).toMatch(/no longer available/i);

    const { token } = await mkShare(env, { subject: "X", angle: "", createdBy: "s@x.com", maxUses: 1 });
    await claimUse(env, token); // fill it
    const full = await call(`/share/${token}`, { headers: { Cookie: await cookie("rcpt@x.com") } });
    expect(await full.text()).toMatch(/no longer available/i);
    expect((await getShare(env, token)).uses).toBe(1); // not over-claimed
  });

  it("no session: shows the landing page with the subject", async () => {
    const { token } = await mkShare(env, { subject: "Chess", angle: "", createdBy: "s@x.com" });
    const res = await call(`/share/${token}`, {});
    const body = await res.text();
    expect(body).toContain("Chess");
    expect(body).toContain("/auth/request");
    expect(body).toContain(token); // the form carries the share token
  });
});

describe("onboarding prefill", () => {
  it("/c/:id/onboard renders the course subject + angle prefilled", async () => {
    const { id } = await createCourse(env, "u@x.com", "Chess", "for clubs");
    const html = await (await call(`/c/${id}/onboard`, {})).text();
    expect(html).toContain("Chess");
    expect(html).toContain("for clubs");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — `/share/:token` 404s; the onboard page has no subject prefilled.

- [ ] **Step 3: Add the page renderers in `pages.mjs`**

Append to `worker/src/pages.mjs` (reuse the existing `SHELL` helper at the top of the file):

```javascript
export function sharePage(subject, token) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  return SHELL("mySensei — start a shared course", `<h1>Learn ${esc(subject)}</h1>
<p class="muted">Someone shared this course with you. Enter your email and we'll send a sign-in link to start your own copy.</p>
<form id="f"><input type="email" name="email" required placeholder="you@example.com"><p><button>Send me a link</button></p><p id="m" class="muted"></p></form>
<script>
var TOKEN=${JSON.stringify(token)};
document.getElementById("f").addEventListener("submit",function(e){e.preventDefault();var em=e.target.email.value;
fetch("/auth/request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em,shareToken:TOKEN})})
.then(function(){document.getElementById("m").textContent="Check your email for a sign-in link to start the course.";});});
</script>`);
}

export function shareUnavailablePage() {
  return SHELL("mySensei", `<h1>Link unavailable</h1><p class="muted">This share link is no longer available — it may have expired or reached its limit.</p>`);
}
```

- [ ] **Step 4: Wire the routes in `worker.mjs`**

Extend the `./pages.mjs` import to add the two new renderers:

```javascript
import { loginPage, dashboardPage, verifyPage, sharePage, shareUnavailablePage } from "./pages.mjs";
```

Add the `GET /share/:token` route just before the `const cm = pathname.match(/^\/c\/...` course-page block:

```javascript
    const shareGet = pathname.match(/^\/share\/([a-z0-9]+)$/);
    if (method === "GET" && shareGet) {
      const token = shareGet[1];
      const share = await getShare(env, token);
      if (!share || share.uses >= share.max_uses) return html(shareUnavailablePage());
      const sess = await sessionEmail(request, env);
      if (sess) {
        if (!(await claimShareUse(env, token))) return html(shareUnavailablePage());
        const { id } = await createCourse(env, sess, share.subject, share.angle || null);
        return new Response(null, { status: 302, headers: { Location: `/c/${id}/onboard` } });
      }
      return html(sharePage(share.subject, token));
    }
```

In the `/c/:id/onboard` branch, pass the stored subject/angle:

```javascript
      if (slug === "onboard") {
        const row = await getCourse(env, cid);
        if (!row) return new Response("not found", { status: 404 });
        return html(renderOnboardHtml({ webhookUrl: `${env.APP_BASE_URL}/submit`, courseId: cid, subject: row.subject || "", angle: row.angle || "" }));
      }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS (the new GET /share + onboarding-prefill tests + the full suite).

- [ ] **Step 6: Commit**

```bash
git add worker/src/pages.mjs worker/src/worker.mjs worker/test/share.test.mjs
git commit -m "feat: GET /share/:token — signed-in accept, landing/unavailable pages, onboarding prefill

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: New-user accept via the magic link

**Files:**
- Modify: `worker/src/worker.mjs`
- Test: `worker/test/share.test.mjs` (extend)

**Interfaces:**
- Consumes: `getShare`, `claimShareUse`, `addToAllowlist`, `createCourse`, `mintToken(email, shareToken)`, `consumeToken => {email, shareToken}`, `sendMagicLink`.
- Produces:
  - `POST /auth/request { email, shareToken }`: a valid, non-full `shareToken` authorizes the magic link (and binds it) even when the email is not allowlisted; otherwise unchanged (allowlisted-only). Always `{ ok: true }`.
  - `POST /auth/verify`: when the consumed token carries a `shareToken`, atomically claim a use (fail → "this share link is full", 400), allowlist the email (`invited_by = 'share'`), create the preset course, and redirect to `/c/:id/onboard`; otherwise redirect to `/dashboard`.

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/share.test.mjs`:

```javascript
import { mintToken } from "../src/auth.mjs";

describe("share accept via magic link", () => {
  it("/auth/request with a valid non-full token sends a link to a NOT-allowlisted email and binds the share", async () => {
    const { token } = await mkShare(env, { subject: "Chess", angle: "", createdBy: "s@x.com" });
    const res = await call("/auth/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "new@x.com", shareToken: token }) });
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalled(); // sendMagicLink fired
    const row = await env.DB.prepare("SELECT share_token FROM magic_tokens WHERE email = 'new@x.com'").first();
    expect(row.share_token).toBe(token);
  });

  it("/auth/request with no token and a non-allowlisted email sends nothing", async () => {
    const res = await call("/auth/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "nobody@x.com" }) });
    expect(res.status).toBe(200);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("/auth/verify on a share-bound token claims a use, allowlists, creates the preset course, redirects to onboarding", async () => {
    const { token: share } = await mkShare(env, { subject: "Chess", angle: "for clubs", createdBy: "s@x.com" });
    const magic = await mintToken(env, "new@x.com", share);
    const res = await call("/auth/verify", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `token=${magic}` });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toMatch(/^\/c\/[a-z0-9]+\/onboard$/);
    expect(res.headers.get("Set-Cookie")).toContain("session=");
    expect((await getShare(env, share)).uses).toBe(1);
    const allow = await env.DB.prepare("SELECT email FROM allowlist WHERE email = 'new@x.com'").first();
    expect(allow).toBeTruthy();
  });

  it("/auth/verify shows 'full' if the share filled between request and verify", async () => {
    const { token: share } = await mkShare(env, { subject: "X", angle: "", createdBy: "s@x.com", maxUses: 1 });
    const magic = await mintToken(env, "late@x.com", share);
    await claimUse(env, share); // someone else fills it first
    const res = await call("/auth/verify", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `token=${magic}` });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/full/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — `/auth/request` ignores `shareToken` (no link to a non-allowlisted email); `/auth/verify` ignores the share token (redirects to `/dashboard`, no course).

- [ ] **Step 3: Update `/auth/request`**

Replace the `POST /auth/request` block:

```javascript
    if (method === "POST" && pathname === "/auth/request") {
      let email = "";
      try { email = String((await request.json()).email || "").trim().toLowerCase(); } catch {}
      if (email && (await isAllowlisted(env, email))) {
        const token = await mintToken(env, email);
        await sendMagicLink(env, email, `${env.APP_BASE_URL}/auth/verify?token=${token}`);
      }
      return json({ ok: true }); // always 200 — no user enumeration
    }
```

with:

```javascript
    if (method === "POST" && pathname === "/auth/request") {
      let email = "", shareToken = "";
      try { const b = await request.json(); email = String(b.email || "").trim().toLowerCase(); shareToken = String(b.shareToken || ""); } catch {}
      if (email) {
        let boundShare = null;
        if (shareToken) {
          const share = await getShare(env, shareToken);
          if (share && share.uses < share.max_uses) boundShare = shareToken;
        }
        if (boundShare || (await isAllowlisted(env, email))) {
          const token = await mintToken(env, email, boundShare);
          await sendMagicLink(env, email, `${env.APP_BASE_URL}/auth/verify?token=${token}`);
        }
      }
      return json({ ok: true }); // always 200 — no user enumeration
    }
```

- [ ] **Step 4: Update `/auth/verify` with the share branch**

Replace the `POST /auth/verify` block (the one Task 2 left at a plain destructure):

```javascript
    if (method === "POST" && pathname === "/auth/verify") {
      const form = await request.formData();
      const consumed = await consumeToken(env, String(form.get("token") || ""));
      if (!consumed) return new Response("This link is invalid or expired. Request a new one.", { status: 400 });
      const { email } = consumed;
      const cookie = sessionCookie(await signSession(email, env.SESSION_SECRET));
      return new Response(null, { status: 302, headers: { Location: "/dashboard", "Set-Cookie": cookie } });
    }
```

with:

```javascript
    if (method === "POST" && pathname === "/auth/verify") {
      const form = await request.formData();
      const consumed = await consumeToken(env, String(form.get("token") || ""));
      if (!consumed) return new Response("This link is invalid or expired. Request a new one.", { status: 400 });
      const { email, shareToken } = consumed;
      let location = "/dashboard";
      if (shareToken) {
        if (!(await claimShareUse(env, shareToken))) return new Response("This share link is full.", { status: 400 });
        await addToAllowlist(env, email, "share");
        const share = await getShare(env, shareToken);
        const { id } = await createCourse(env, email, share.subject, share.angle || null);
        location = `/c/${id}/onboard`;
      }
      const cookie = sessionCookie(await signSession(email, env.SESSION_SECRET));
      return new Response(null, { status: 302, headers: { Location: location, "Set-Cookie": cookie } });
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS (the 4 new accept-via-magic-link tests + the full suite, including the existing `/auth/request` allowlisted-only and `/auth/verify` dashboard-redirect tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/worker.mjs worker/test/share.test.mjs
git commit -m "feat: share accept via magic link — claim use, allowlist, preset course, onboarding

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Dashboard Share button

**Files:**
- Modify: `worker/src/pages.mjs`
- Test: `worker/test/pages.test.mjs`

**Interfaces:**
- Consumes: `POST /api/courses/:id/share => { url }` (Task 4).
- Produces: each course card with a subject shows a **Share** control; clicking it posts to `/api/courses/:id/share` and reveals the returned link inline for copying. Event-delegation wired, no `onclick`.

- [ ] **Step 1: Update the dashboard test**

In `worker/test/pages.test.mjs`, add a test (alongside the existing dashboard tests):

```javascript
it("dashboard course cards expose a Share control wired by delegation", async () => {
  const html = await (await get("/dashboard")).text();
  expect(html).toContain("data-share");          // per-card share button
  expect(html).toContain("function share(");      // share handler
  expect(html).toContain("/api/courses/");
  expect(html).toContain("/share");
  expect(html).not.toContain("onclick=");          // delegation, no inline handlers
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `worker/`): `npm test`
Expected: FAIL — `data-share` / `function share(` not present.

- [ ] **Step 3: Implement the Share control in `dashboardPage()`**

In `worker/src/pages.mjs`, inside `dashboardPage()`'s inline `<script>`:

(a) Add a `share()` function immediately before `function load(){`:

```javascript
function share(id){
  var box=document.querySelector('[data-sb="'+id+'"]'); if(box) box.textContent="…";
  fetch("/api/courses/"+id+"/share",{method:"POST"}).then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d||!d.url){ if(box) box.textContent="(couldn't make a link)"; return; }
    if(box){ box.innerHTML='<input readonly value="'+esc(d.url)+'" style="width:100%">'; box.querySelector("input").select(); }
  });
}
```

(b) In the card template inside `load()`, add a Share button + a slot for the link, only when the course has a subject. Change the card-building return (the `return '<div class="c">...` line) so it includes, after `open+btn`:

```javascript
    var shareBtn=c.subject?'<button data-share="'+esc(c.id)+'">Share</button> <span class="muted" data-sb="'+esc(c.id)+'"></span>':'';
    return '<div class="c"><b>'+esc(c.subject||"(new course)")+'</b>'+badge+'<div class="muted">'+esc(c.status)+" \xb7 level "+esc(c.level||"?")+" \xb7 "+prog+'</div><p>'+open+btn+shareBtn+'</p></div>';
```

(c) Extend the existing `#list` delegation handler to route the Share button. The current handler is:

```javascript
document.getElementById("list").addEventListener("click",function(e){var b=e.target.closest("button[data-act]");if(b)act(b.getAttribute("data-id"),b.getAttribute("data-act"));});
```

Replace it with:

```javascript
document.getElementById("list").addEventListener("click",function(e){
  var b=e.target.closest("button[data-act]");if(b){act(b.getAttribute("data-id"),b.getAttribute("data-act"));return;}
  var s=e.target.closest("button[data-share]");if(s){share(s.getAttribute("data-share"));}
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `worker/`): `npm test`
Expected: PASS (the new dashboard test + the full suite; the existing "no `onclick=`" and delegation regression tests still hold).

- [ ] **Step 5: Commit**

```bash
git add worker/src/pages.mjs worker/test/pages.test.mjs
git commit -m "feat: dashboard Share button — mint + reveal a share link per course

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Post-implementation (owner-operated)

After merge: apply the migration + redeploy (same as prior features):

```bash
cd worker && npx wrangler d1 migrations apply mysensei --remote
npm run deploy
```

Live check: open a course, click Share, copy the link; open it in a private window (no session), enter a fresh email, click the magic link, and confirm you land on onboarding with the topic + angle pre-filled and a placement check follows.

---

## Self-Review

**Spec coverage** (against `2026-06-24-course-sharing-design.md`):
- `shares` table + `magic_tokens.share_token` → Task 1, Task 2. ✓
- `createShare`/`getShare`/atomic `claimShareUse` → Task 1. ✓
- `createCourse` presets subject+angle (spec's `createCourseWithSubject`, implemented as an extension of `createCourse` per the spec's "reuse/extend rather than duplicate") → Task 1. ✓
- `mintToken(shareToken)` + `consumeToken => {email, shareToken}` → Task 2. ✓
- `POST /api/courses/:id/share` (owner 200; non-owner 404; bare-draft 400; unauth 401) → Task 4. ✓
- `GET /share/:token` (invalid/full page; signed-in claim+preset+redirect; landing) → Task 5. ✓
- onboarding prefill (renderer + route) → Task 3 (renderer), Task 5 (route wiring). ✓
- `/auth/request` shareToken authorizes a non-allowlisted email; `/auth/verify` claims a use, allowlists `invited_by='share'`, creates preset course, redirects → Task 6. ✓
- Use consumed/allowlisted only at verify (or the signed-in `/share` path) → Tasks 5/6. ✓
- Dashboard Share control → Task 7. ✓
- Error handling: invalid/full token, bare draft, non-owner, unauth, fill-between-request-and-verify → Tasks 4/5/6 tests. ✓

**Placeholder scan:** none — every code step shows complete before/after code; every test step shows full test code.

**Type consistency:** `createShare({subject,angle,createdBy,maxUses}) => {token}` (Task 1) consumed in Tasks 4/5/6. `getShare => row` with `.subject/.angle/.uses/.max_uses` used consistently in Tasks 5/6. `claimShareUse => boolean` used in Tasks 5/6. `createCourse(env, email, subject, angle) => {id}` (Task 1) called in Tasks 5/6. `consumeToken => {email, shareToken}` (Task 2) consumed in Task 6 (and the Task 2 interim destructure). `sharePage(subject, token)`/`shareUnavailablePage()` (Task 5) imported in Task 5's worker wiring. `POST /api/courses/:id/share => {url}` (Task 4) consumed by Task 7's `share()`. Worker `./db.mjs` import adds `createShare, getShare, claimShareUse` once (Task 4) and they're used through Task 6. Consistent. ✓
