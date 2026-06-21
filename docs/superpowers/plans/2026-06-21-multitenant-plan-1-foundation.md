# Multi-tenant Foundation — Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the multi-tenant foundation — a Cloudflare Worker backed by D1 — so an allowlisted learner logs in with a passwordless magic link and manages their own course records (create / list / pause / resume) from a dashboard. No lesson generation yet (Plan 2).

**Architecture:** A single Cloudflare Worker is the API and web server. It stores everything in Cloudflare D1 (serverless SQLite). Auth is a magic-link flow: the Worker mints a one-time token, asks a lightweight GitHub Action to email the login link via Gmail, and on click sets a signed JWT cookie. The dashboard and APIs are scoped to the logged-in learner's email; an allowlist gates who can get in; an active-course cap bounds cost.

**Tech Stack:** Cloudflare Workers (ESM), Cloudflare D1, `wrangler` 4.x, Web Crypto (HMAC-SHA256 for JWT + tokens), `vitest` + `@cloudflare/vitest-pool-workers` for Worker/D1 tests, existing Gmail/nodemailer GitHub Action for email.

## Global Constraints

- Worker code is ESM `.mjs`, lives under `worker/`. No new external runtime deps in the Worker (use Web Crypto, not a JWT library).
- All emails go through Gmail via a GitHub Action (`MAIL_FROM` / `GMAIL_APP_PASSWORD` already configured as repo secrets/vars). The Worker never sends email directly.
- Worker secrets: `SESSION_SECRET` (HMAC key for JWT), `GITHUB_TOKEN` (Contents: write — fires `repository_dispatch`), reuse `GITHUB_OWNER`/`GITHUB_REPO` vars. Set via `wrangler secret put`.
- Identity = email (lowercased, trimmed). No passwords.
- Active-course cap default: **3** per learner.
- Magic token TTL: **15 minutes**, single-use. Session cookie TTL: **30 days**, `HttpOnly; Secure; SameSite=Lax`.
- D1 binding name in `wrangler.toml`: `DB`.
- Course ids: 12-char lowercase base36 from `crypto.getRandomValues`.

---

### Task 1: Worker project scaffold + D1 binding + test harness

**Files:**
- Modify: `worker/wrangler.toml`
- Create: `worker/package.json`
- Create: `worker/vitest.config.mjs`
- Create: `worker/test/smoke.test.mjs`

**Interfaces:**
- Produces: a deployable Worker with a `DB` D1 binding and a passing `vitest` harness that later tasks add tests to.

- [ ] **Step 1: Write the failing smoke test**

```js
// worker/test/smoke.test.mjs
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.mjs";

describe("smoke", () => {
  it("D1 binding is present and queryable", async () => {
    const row = await env.DB.prepare("SELECT 1 AS ok").first();
    expect(row.ok).toBe(1);
  });
  it("unknown route returns 404", async () => {
    const req = new Request("https://x/nope");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Create `worker/package.json`**

```json
{
  "name": "mysensei-worker",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run", "deploy": "wrangler deploy" },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "vitest": "^2.0.0",
    "wrangler": "^4.86.0"
  }
}
```

- [ ] **Step 3: Create `worker/vitest.config.mjs`**

```js
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: { d1Databases: ["DB"] },
      },
    },
  },
});
```

- [ ] **Step 4: Rewrite `worker/wrangler.toml`** (keep existing vars, add D1 + main pointing at the new router; the current quiz logic moves in Task 7)

```toml
name = "mysensei-quiz-helper"
main = "src/worker.mjs"
compatibility_date = "2026-06-01"

[vars]
GITHUB_OWNER = "yoelf22"
GITHUB_REPO = "mySensei"
APP_BASE_URL = "https://mysensei-quiz-helper.yoelf22mysensei.workers.dev"

[[d1_databases]]
binding = "DB"
database_name = "mysensei"
database_id = "PLACEHOLDER_SET_AFTER_CREATE"

# Secrets (not here): SESSION_SECRET, GITHUB_TOKEN, GMAIL_APP_PASSWORD is on the Action side.
# Create the DB once:  cd worker && npx wrangler d1 create mysensei
# then paste the printed database_id above.
```

- [ ] **Step 5: Minimal router so the harness compiles** (full routing in later tasks)

```js
// worker/src/worker.mjs
export default {
  async fetch(request, env) {
    return new Response("not found", { status: 404 });
  },
};
```

- [ ] **Step 6: Install + run**

Run: `cd worker && npm install && npm test`
Expected: smoke tests PASS (D1 query returns 1; unknown route 404).

- [ ] **Step 7: Commit**

```bash
git add worker/package.json worker/vitest.config.mjs worker/wrangler.toml worker/src/worker.mjs worker/test/smoke.test.mjs
git commit -m "worker: scaffold multi-tenant Worker with D1 binding + vitest harness"
```

---

### Task 2: D1 schema migration

**Files:**
- Create: `worker/migrations/0001_init.sql`
- Create: `worker/test/schema.test.mjs`

**Interfaces:**
- Produces: tables `allowlist`, `learners`, `courses`, `magic_tokens`, `pages` (applied to the test DB by the pool automatically from `migrations/`).

- [ ] **Step 1: Write the failing test**

```js
// worker/test/schema.test.mjs
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("schema", () => {
  it("courses table has the expected columns", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(courses)").all();
    const cols = results.map((r) => r.name);
    for (const c of ["id","owner_email","subject","settings","status","start_level","level","research","assessment","outline","progress","last_error","created_at","updated_at"]) {
      expect(cols).toContain(c);
    }
  });
  it("allowlist + magic_tokens exist", async () => {
    await env.DB.prepare("INSERT INTO allowlist(email, added_at) VALUES('a@b.com','t')").run();
    const row = await env.DB.prepare("SELECT email FROM allowlist WHERE email='a@b.com'").first();
    expect(row.email).toBe("a@b.com");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- schema`
Expected: FAIL ("no such table: courses").

- [ ] **Step 3: Write the migration**

```sql
-- worker/migrations/0001_init.sql
CREATE TABLE allowlist (email TEXT PRIMARY KEY, added_at TEXT NOT NULL);
CREATE TABLE learners (email TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  subject TEXT, angle TEXT,
  settings TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  start_level INTEGER, level INTEGER,
  research TEXT, assessment TEXT, outline TEXT, progress TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_courses_owner ON courses(owner_email);
CREATE INDEX idx_courses_status ON courses(status);
CREATE TABLE magic_tokens (token TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE pages (course_id TEXT NOT NULL, path TEXT NOT NULL, html TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (course_id, path));
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npm test -- schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/migrations/0001_init.sql worker/test/schema.test.mjs
git commit -m "worker: D1 schema (allowlist, learners, courses, magic_tokens, pages)"
```

---

### Task 3: Data-access layer (`db.mjs`)

**Files:**
- Create: `worker/src/db.mjs`
- Create: `worker/test/db.test.mjs`

**Interfaces:**
- Produces:
  - `isAllowlisted(env, email): Promise<boolean>`
  - `createCourse(env, ownerEmail): Promise<{id}>` — inserts a `draft` course, returns its id
  - `listCourses(env, ownerEmail): Promise<Course[]>` — rows for that owner, newest first
  - `getCourse(env, id): Promise<Course|null>`
  - `setStatus(env, id, status): Promise<void>`
  - `countActive(env, ownerEmail): Promise<number>` — courses with status `active`
  - `now(): string` — ISO timestamp (injectable for tests via `nowFn`)
  - `randomId(len=12): string`
  - Course rows have JSON columns parsed to objects (`settings`, `assessment`, `outline`, `progress`).

- [ ] **Step 1: Write the failing test**

```js
// worker/test/db.test.mjs
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { isAllowlisted, createCourse, listCourses, getCourse, setStatus, countActive } from "../src/db.mjs";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM allowlist; DELETE FROM courses;");
});

describe("db", () => {
  it("allowlist check is case-insensitive", async () => {
    await env.DB.prepare("INSERT INTO allowlist(email, added_at) VALUES('me@x.com','t')").run();
    expect(await isAllowlisted(env, "ME@X.com")).toBe(true);
    expect(await isAllowlisted(env, "no@x.com")).toBe(false);
  });
  it("create/list/get a course", async () => {
    const { id } = await createCourse(env, "me@x.com");
    const got = await getCourse(env, id);
    expect(got.owner_email).toBe("me@x.com");
    expect(got.status).toBe("draft");
    const list = await listCourses(env, "me@x.com");
    expect(list.map((c) => c.id)).toContain(id);
  });
  it("countActive counts only active courses", async () => {
    const a = await createCourse(env, "me@x.com");
    const b = await createCourse(env, "me@x.com");
    await setStatus(env, a.id, "active");
    await setStatus(env, b.id, "active");
    expect(await countActive(env, "me@x.com")).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- db`
Expected: FAIL (cannot import from `db.mjs`).

- [ ] **Step 3: Implement `db.mjs`**

```js
// worker/src/db.mjs
const JSON_COLS = ["settings", "assessment", "outline", "progress"];

export function now() { return new Date().toISOString(); }

export function randomId(len = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

function norm(email) { return String(email || "").trim().toLowerCase(); }

function parse(row) {
  if (!row) return null;
  const out = { ...row };
  for (const c of JSON_COLS) out[c] = row[c] ? JSON.parse(row[c]) : null;
  return out;
}

export async function isAllowlisted(env, email) {
  const row = await env.DB.prepare("SELECT email FROM allowlist WHERE email = ?").bind(norm(email)).first();
  return !!row;
}

export async function createCourse(env, ownerEmail) {
  const id = randomId();
  const t = now();
  await env.DB.prepare(
    "INSERT INTO courses(id, owner_email, status, created_at, updated_at) VALUES(?,?,?,?,?)",
  ).bind(id, norm(ownerEmail), "draft", t, t).run();
  return { id };
}

export async function listCourses(env, ownerEmail) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM courses WHERE owner_email = ? ORDER BY created_at DESC",
  ).bind(norm(ownerEmail)).all();
  return results.map(parse);
}

export async function getCourse(env, id) {
  return parse(await env.DB.prepare("SELECT * FROM courses WHERE id = ?").bind(id).first());
}

export async function setStatus(env, id, status) {
  await env.DB.prepare("UPDATE courses SET status = ?, updated_at = ? WHERE id = ?").bind(status, now(), id).run();
}

export async function countActive(env, ownerEmail) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM courses WHERE owner_email = ? AND status = 'active'",
  ).bind(norm(ownerEmail)).first();
  return row.n;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npm test -- db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/db.mjs worker/test/db.test.mjs
git commit -m "worker: D1 data-access layer (allowlist, courses, active count)"
```

---

### Task 4: Signed-session + magic-token helpers (`auth.mjs`)

**Files:**
- Create: `worker/src/auth.mjs`
- Create: `worker/test/auth.test.mjs`

**Interfaces:**
- Produces:
  - `signSession(email, secret, nowMs): Promise<string>` — HMAC-signed `email.exp.sig`, 30-day exp
  - `verifySession(token, secret, nowMs): Promise<string|null>` — returns email or null if bad/expired
  - `mintToken(env, email): Promise<string>` — inserts a `magic_tokens` row (15-min TTL), returns token
  - `consumeToken(env, token): Promise<string|null>` — returns email if valid+unused+unexpired, marks used; else null

- [ ] **Step 1: Write the failing test**

```js
// worker/test/auth.test.mjs
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { signSession, verifySession, mintToken, consumeToken } from "../src/auth.mjs";

const SECRET = "test-secret";
beforeEach(async () => { await env.DB.exec("DELETE FROM magic_tokens;"); });

describe("auth", () => {
  it("session round-trips and rejects tampering + expiry", async () => {
    const t = await signSession("me@x.com", SECRET, 1000);
    expect(await verifySession(t, SECRET, 2000)).toBe("me@x.com");
    expect(await verifySession(t + "x", SECRET, 2000)).toBe(null);
    expect(await verifySession(t, SECRET, 1000 + 31 * 86400 * 1000)).toBe(null);
  });
  it("magic token is single-use and expires", async () => {
    const tok = await mintToken(env, "me@x.com");
    expect(await consumeToken(env, tok)).toBe("me@x.com");
    expect(await consumeToken(env, tok)).toBe(null); // already used
    expect(await consumeToken(env, "bogus")).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- auth`
Expected: FAIL (cannot import `auth.mjs`).

- [ ] **Step 3: Implement `auth.mjs`**

```js
// worker/src/auth.mjs
import { now, randomId } from "./db.mjs";

const SESSION_DAYS = 30;
const TOKEN_MIN = 15;
const enc = new TextEncoder();

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
async function hmac(data, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function signSession(email, secret, nowMs = Date.now()) {
  const exp = nowMs + SESSION_DAYS * 86400 * 1000;
  const payload = `${email}.${exp}`;
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifySession(token, secret, nowMs = Date.now()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [email, exp, sig] = parts;
  if ((await hmac(`${email}.${exp}`, secret)) !== sig) return null;
  if (Number(exp) < nowMs) return null;
  return email;
}

export async function mintToken(env, email) {
  const token = randomId(24);
  const expires = new Date(Date.now() + TOKEN_MIN * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO magic_tokens(token, email, expires_at, used) VALUES(?,?,?,0)")
    .bind(token, String(email).trim().toLowerCase(), expires).run();
  return token;
}

export async function consumeToken(env, token) {
  const row = await env.DB.prepare("SELECT email, expires_at, used FROM magic_tokens WHERE token = ?").bind(token).first();
  if (!row || row.used || row.expires_at < now()) return null;
  await env.DB.prepare("UPDATE magic_tokens SET used = 1 WHERE token = ?").bind(token).run();
  return row.email;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npm test -- auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/auth.mjs worker/test/auth.test.mjs
git commit -m "worker: HMAC session + single-use magic-token helpers"
```

---

### Task 5: Email-dispatch — Worker fires a Gmail Action

**Files:**
- Create: `worker/src/email.mjs`
- Create: `.github/workflows/send-mail.yml`
- Modify: `scripts/email-link.mjs` (already generic; confirm it reads `EMAIL_SUBJECT/INTRO/URL`)
- Create: `worker/test/email.test.mjs`

**Interfaces:**
- Produces: `sendMagicLink(env, email, url): Promise<void>` — fires a `repository_dispatch` (`event_type: "send-mail"`) with `{ to, subject, intro, url }`; the `send-mail` workflow emails via Gmail.
- Consumes: `env.GITHUB_TOKEN`, `env.GITHUB_OWNER`, `env.GITHUB_REPO`.

- [ ] **Step 1: Write the failing test** (stub `fetch` to assert the dispatch shape)

```js
// worker/test/email.test.mjs
import { describe, it, expect, vi } from "vitest";
import { sendMagicLink } from "../src/email.mjs";

describe("email dispatch", () => {
  it("fires a send-mail repository_dispatch with the login link", async () => {
    const calls = [];
    const env = { GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r" };
    globalThis.fetch = vi.fn(async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response("{}", { status: 204 }); });
    await sendMagicLink(env, "me@x.com", "https://app/auth/verify?token=abc");
    expect(calls[0].url).toContain("/repos/o/r/dispatches");
    expect(calls[0].body.event_type).toBe("send-mail");
    expect(calls[0].body.client_payload.to).toBe("me@x.com");
    expect(calls[0].body.client_payload.url).toContain("token=abc");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- email`
Expected: FAIL (cannot import `email.mjs`).

- [ ] **Step 3: Implement `email.mjs`**

```js
// worker/src/email.mjs
export async function sendMagicLink(env, email, url) {
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
        subject: "mySensei — your sign-in link",
        intro: "Click to sign in to your mySensei dashboard. This link expires in 15 minutes.",
        url,
      },
    }),
  });
  if (!res.ok) throw new Error(`dispatch failed: ${res.status}`);
}
```

- [ ] **Step 4: Create the `send-mail` workflow**

```yaml
# .github/workflows/send-mail.yml
name: send-mail
on:
  repository_dispatch:
    types: [send-mail]
permissions:
  contents: read
jobs:
  mail:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm install --no-audit --no-fund
      - name: Send the email
        env:
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
          MAIL_FROM: ${{ vars.MAIL_FROM }}
          MAIL_TO: ${{ github.event.client_payload.to }}
          EMAIL_SUBJECT: ${{ github.event.client_payload.subject }}
          EMAIL_INTRO: ${{ github.event.client_payload.intro }}
          EMAIL_URL: ${{ github.event.client_payload.url }}
        run: node scripts/email-link.mjs
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd worker && npm test -- email`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/email.mjs worker/test/email.test.mjs .github/workflows/send-mail.yml
git commit -m "worker: magic-link email via a Gmail send-mail Action"
```

---

### Task 6: Auth + dashboard API routing (`worker.mjs`)

**Files:**
- Modify: `worker/src/worker.mjs`
- Create: `worker/src/cookies.mjs`
- Create: `worker/test/routes.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 3–5.
- Produces HTTP routes:
  - `POST /auth/request` `{email}` → 200 always (no user enumeration); if allowlisted, mints token + sends link
  - `GET /auth/verify?token=` → consume token → set session cookie → 302 to `/dashboard`
  - `GET /api/courses` (cookie) → `{courses:[...]}` (401 if no/invalid session)
  - `POST /api/courses` (cookie) → create draft → `{id}`
  - `POST /api/courses/:id/pause` (cookie, owner) → status `paused`
  - `POST /api/courses/:id/resume` (cookie, owner) → status `active` IF `countActive < 3`, else 409 `{error:"cap"}`

- [ ] **Step 1: Write the failing test**

```js
// worker/test/routes.test.mjs
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../src/worker.mjs";
import { signSession } from "../src/auth.mjs";

const E = { ...env, SESSION_SECRET: "s", GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r" };
async function call(path, init) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://app" + path, init), E, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
async function cookie(email) { return "session=" + (await signSession(email, "s")); }

beforeEach(async () => {
  await env.DB.exec("DELETE FROM allowlist; DELETE FROM courses; DELETE FROM magic_tokens;");
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 204 }));
});

describe("routes", () => {
  it("auth/request is 200 for non-allowlisted but sends nothing", async () => {
    const res = await call("/auth/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "x@y.com" }) });
    expect(res.status).toBe(200);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("dashboard API requires a session", async () => {
    expect((await call("/api/courses", {})).status).toBe(401);
  });
  it("create + list + cap on resume", async () => {
    const h = { Cookie: await cookie("me@x.com"), "Content-Type": "application/json" };
    const made = await (await call("/api/courses", { method: "POST", headers: h })).json();
    const list = await (await call("/api/courses", { headers: h })).json();
    expect(list.courses.map((c) => c.id)).toContain(made.id);
    // force 3 active, then a 4th resume is capped
    for (let i = 0; i < 3; i++) { const c = await (await call("/api/courses", { method: "POST", headers: h })).json(); await call(`/api/courses/${c.id}/resume`, { method: "POST", headers: h }); }
    const capped = await call(`/api/courses/${made.id}/resume`, { method: "POST", headers: h });
    expect(capped.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- routes`
Expected: FAIL (routes not implemented).

- [ ] **Step 3: Implement `cookies.mjs`**

```js
// worker/src/cookies.mjs
export function getCookie(request, name) {
  const h = request.headers.get("Cookie") || "";
  const m = h.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
export function sessionCookie(value) {
  return `session=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`;
}
```

- [ ] **Step 4: Implement the router in `worker.mjs`**

```js
// worker/src/worker.mjs
import { isAllowlisted, createCourse, listCourses, getCourse, setStatus, countActive } from "./db.mjs";
import { signSession, verifySession, mintToken, consumeToken } from "./auth.mjs";
import { sendMagicLink } from "./email.mjs";
import { getCookie, sessionCookie } from "./cookies.mjs";

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...extra } });

async function sessionEmail(request, env) {
  const tok = getCookie(request, "session");
  return tok ? verifySession(tok, env.SESSION_SECRET) : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (method === "POST" && pathname === "/auth/request") {
      let email = "";
      try { email = String((await request.json()).email || "").trim().toLowerCase(); } catch {}
      if (email && (await isAllowlisted(env, email))) {
        const token = await mintToken(env, email);
        await sendMagicLink(env, email, `${env.APP_BASE_URL}/auth/verify?token=${token}`);
      }
      return json({ ok: true }); // always 200 — no user enumeration
    }

    if (method === "GET" && pathname === "/auth/verify") {
      const email = await consumeToken(env, url.searchParams.get("token") || "");
      if (!email) return new Response("This link is invalid or expired. Request a new one.", { status: 400 });
      const cookie = sessionCookie(await signSession(email, env.SESSION_SECRET));
      return new Response(null, { status: 302, headers: { Location: "/dashboard", "Set-Cookie": cookie } });
    }

    if (pathname === "/api/courses") {
      const email = await sessionEmail(request, env);
      if (!email) return json({ error: "unauthorized" }, 401);
      if (method === "GET") return json({ courses: await listCourses(env, email) });
      if (method === "POST") return json(await createCourse(env, email));
    }

    const m = pathname.match(/^\/api\/courses\/([a-z0-9]+)\/(pause|resume)$/);
    if (m && method === "POST") {
      const email = await sessionEmail(request, env);
      if (!email) return json({ error: "unauthorized" }, 401);
      const course = await getCourse(env, m[1]);
      if (!course || course.owner_email !== email) return json({ error: "not found" }, 404);
      if (m[2] === "pause") { await setStatus(env, course.id, "paused"); return json({ ok: true }); }
      if ((await countActive(env, email)) >= 3) return json({ error: "cap" }, 409);
      await setStatus(env, course.id, "active");
      return json({ ok: true });
    }

    return new Response("not found", { status: 404 });
  },
};
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd worker && npm test -- routes`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/worker.mjs worker/src/cookies.mjs worker/test/routes.test.mjs
git commit -m "worker: magic-link auth + dashboard course API (create/list/pause/resume + cap)"
```

---

### Task 7: Port the existing quiz/onboard/assessment/approve callbacks into the router

**Files:**
- Modify: `worker/src/worker.mjs`
- Create: `worker/src/dispatch.mjs`
- Create: `worker/test/callbacks.test.mjs`

**Interfaces:**
- Produces: `POST /submit` routing by `body.type` (`quiz` | `onboard` | `assessment` | `approve`) → `repository_dispatch`, identical mapping to the current standalone worker (Tasks here just move it into the unified router so nothing regresses). Each payload now also requires a `courseId` (validated, passed through) — Plan 2 consumes it.

- [ ] **Step 1: Write the failing test**

```js
// worker/test/callbacks.test.mjs
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "../src/worker.mjs";

const E = { ...env, GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r" };
beforeEach(() => { globalThis.fetch = vi.fn(async () => new Response("{}", { status: 204 })); });

it("quiz submit dispatches quiz-result with courseId + missed", async () => {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://app/submit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "quiz", courseId: "abc", module: 1, attempt: 1, score: 4, total: 5, missed: ["x"] }),
  }), E, ctx);
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(200);
  const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
  expect(body.event_type).toBe("quiz-result");
  expect(body.client_payload.courseId).toBe("abc");
  expect(body.client_payload.missed).toEqual(["x"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- callbacks`
Expected: FAIL (`/submit` not handled).

- [ ] **Step 3: Implement `dispatch.mjs`** (the routing logic from the current `worker/src/worker.mjs`, plus `courseId`)

```js
// worker/src/dispatch.mjs
export function buildDispatch(body) {
  const type = body.type || "quiz";
  const courseId = String(body.courseId || "");
  if (!courseId) return { error: "missing courseId" };

  if (type === "onboard") {
    if (!body.subject) return { error: "missing subject" };
    if (!body.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) return { error: "missing or invalid email" };
    return { event_type: "onboard", client_payload: { courseId, subject: body.subject, email: body.email, angle: body.angle || "", language: body.language || "English", languageCode: body.languageCode || "en", chunkMinutes: Number(body.chunkMinutes) || 10, cadence: body.cadence === "weekly" ? "weekly" : "daily", deliveryTime: body.deliveryTime || "07:00", timezone: body.timezone || "UTC", workweekDays: Array.isArray(body.workweekDays) ? body.workweekDays : [0,1,2,3,4,5,6] } };
  }
  if (type === "assessment") {
    if (!Array.isArray(body.results) || !body.results.length) return { error: "missing results" };
    return { event_type: "assessment-result", client_payload: { courseId, results: body.results.map((r) => ({ level: Number(r.level), correct: !!r.correct })) } };
  }
  if (type === "approve") return { event_type: "syllabus-approved", client_payload: { courseId } };

  const module = Number(body.module), attempt = Number(body.attempt) || 1, score = Number(body.score), total = Number(body.total);
  if (![module, score, total].every(Number.isInteger) || total <= 0 || score < 0 || score > total) return { error: "invalid result" };
  return { event_type: "quiz-result", client_payload: { courseId, module, attempt, score, total, missed: Array.isArray(body.missed) ? body.missed.map(String).slice(0, 20) : [] } };
}
```

- [ ] **Step 4: Wire `/submit` into `worker.mjs`** (add near the other routes, before the final 404)

```js
    if (method === "POST" && pathname === "/submit") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
      const d = buildDispatch(body);
      if (d.error) return json({ error: d.error }, 400);
      const gh = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "mySensei-worker", "Content-Type": "application/json" },
        body: JSON.stringify({ event_type: d.event_type, client_payload: d.client_payload }),
      });
      if (!gh.ok) return json({ error: "dispatch failed", status: gh.status }, 502);
      return json({ ok: true });
    }
```

Add the import at the top: `import { buildDispatch } from "./dispatch.mjs";`. Also keep the CORS headers (`OPTIONS` 204 + `Access-Control-Allow-*`) from the current worker — copy that block verbatim at the top of `fetch`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd worker && npm test`
Expected: ALL worker tests PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/worker.mjs worker/src/dispatch.mjs worker/test/callbacks.test.mjs
git commit -m "worker: unify form/quiz/approve callbacks into the router, keyed by courseId"
```

---

### Task 8: Dashboard + login pages (served by the Worker)

**Files:**
- Create: `worker/src/pages.mjs` (returns the login + dashboard HTML)
- Modify: `worker/src/worker.mjs` (serve `/` and `/dashboard`)
- Create: `worker/test/pages.test.mjs`

**Interfaces:**
- Produces: `GET /` → login HTML (email field → `POST /auth/request`); `GET /dashboard` → dashboard HTML (client fetches `/api/courses`, renders list, buttons call the course APIs). Pure HTML strings; no framework.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- pages`
Expected: FAIL (`/` and `/dashboard` return 404).

- [ ] **Step 3: Implement `pages.mjs`** (two self-contained HTML pages — login posts the email; dashboard fetches courses and wires the action buttons)

```js
// worker/src/pages.mjs
const SHELL = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:17px/1.6 Georgia,serif;background:#faf8f3;color:#1d1b16;max-width:42rem;margin:0 auto;padding:2.5rem 1.25rem}
button{font:inherit;background:#b4541f;color:#fff;border:0;border-radius:.4rem;padding:.6rem 1.2rem;cursor:pointer}
input{font:inherit;padding:.6rem;border:1px solid #e7e1d5;border-radius:.4rem;width:100%}
.c{border:1px solid #e7e1d5;border-radius:.5rem;padding:1rem;margin:1rem 0;font-family:system-ui,sans-serif}
.muted{color:#6b6457;font-family:system-ui,sans-serif}</style></head><body>${body}</body></html>`;

export function loginPage() {
  return SHELL("mySensei — sign in", `<h1>mySensei</h1><p class="muted">Enter your email; we'll send a sign-in link.</p>
<form id="f"><input type="email" name="email" required placeholder="you@example.com"><p><button>Send me a link</button></p><p id="m" class="muted"></p></form>
<script>document.getElementById("f").addEventListener("submit",function(e){e.preventDefault();var em=e.target.email.value;
fetch("/auth/request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em})})
.then(function(){document.getElementById("m").textContent="If your email is on the list, a sign-in link is on its way.";});});</script>`);
}

export function dashboardPage() {
  return SHELL("mySensei — my courses", `<h1>My courses</h1><p><button id="new">Start a new course</button></p><div id="list" class="muted">Loading…</div>
<script>
function load(){fetch("/api/courses").then(function(r){if(r.status===401){location.href="/";return;}return r.json();}).then(function(d){
  if(!d)return; var el=document.getElementById("list");
  if(!d.courses.length){el.textContent="No courses yet — start one.";return;}
  el.innerHTML=d.courses.map(function(c){
    var prog=c.progress?("module "+c.progress.currentModule):"";
    return '<div class="c"><b>'+(c.subject||"(new course)")+'</b><div class="muted">'+c.status+" · level "+(c.level||"?")+" · "+prog+'</div>'+
      (c.status==="paused"?'<button onclick="act(\\''+c.id+'\\',\\'resume\\')">Resume</button>':'')+
      (c.status==="active"?'<button onclick="act(\\''+c.id+'\\',\\'pause\\')">Pause</button>':'')+'</div>';
  }).join("");
});}
function act(id,what){fetch("/api/courses/"+id+"/"+what,{method:"POST"}).then(function(r){if(r.status===409){alert("You're at your active-course limit — pause one first.");}load();});}
document.getElementById("new").addEventListener("click",function(){fetch("/api/courses",{method:"POST"}).then(function(r){return r.json();}).then(function(d){location.href="/c/"+d.id+"/onboard";});});
load();
</script>`);
}
```

- [ ] **Step 4: Serve the pages in `worker.mjs`** (add before the 404, import at top)

```js
import { loginPage, dashboardPage } from "./pages.mjs";
// ...
    const html = (s) => new Response(s, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (method === "GET" && pathname === "/") return html(loginPage());
    if (method === "GET" && pathname === "/dashboard") return html(dashboardPage());
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd worker && npm test`
Expected: ALL tests PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/pages.mjs worker/src/worker.mjs worker/test/pages.test.mjs
git commit -m "worker: serve login + dashboard pages"
```

---

### Task 9: Deploy + manual end-to-end check

**Files:** none (operational)

- [ ] **Step 1: Create the D1 database**

Run: `cd worker && npx wrangler d1 create mysensei`
Then paste the printed `database_id` into `wrangler.toml`. Commit that change.

- [ ] **Step 2: Apply the migration to the remote DB**

Run: `cd worker && npx wrangler d1 migrations apply mysensei --remote`
Expected: `0001_init.sql` applied.

- [ ] **Step 3: Set Worker secrets**

Run (each prompts; paste the value):
```
cd worker
npx wrangler secret put SESSION_SECRET     # any long random string
npx wrangler secret put GITHUB_TOKEN        # fine-grained token, Contents: write on the repo
```

- [ ] **Step 4: Seed the allowlist with the owner email**

Run: `cd worker && npx wrangler d1 execute mysensei --remote --command "INSERT INTO allowlist(email, added_at) VALUES('yoel.frischoff@gmail.com', datetime('now'))"`

- [ ] **Step 5: Deploy**

Run: `cd worker && npx wrangler deploy`
Expected: prints the worker URL (confirm it matches `APP_BASE_URL`; update + redeploy if not).

- [ ] **Step 6: Manual smoke**

1. Open the worker URL `/` → enter the allowlisted email → submit.
2. Expect a "sign-in link" email within ~1 min (the `send-mail` Action).
3. Click it → lands on `/dashboard` (empty list).
4. "Start a new course" → redirects to `/c/<id>/onboard` (a 404 page for now — that route is built in Plan 2; the course row exists in D1).
5. Back on `/dashboard`, the new (draft) course appears.

- [ ] **Step 7: Commit the database_id change**

```bash
git add worker/wrangler.toml
git commit -m "worker: pin D1 database_id"
```

---

## Self-review notes

- **Spec coverage:** allowlist gate ✓ (Tasks 3,6,9), magic-link auth ✓ (4,6), dashboard + course CRUD + cap ✓ (6,8), D1 store ✓ (2,3), email-via-Gmail-Action ✓ (5), courseId-keyed callbacks ✓ (7). Generation, cron sweep, page-serving of lessons, and migration of the live course are **explicitly Plan 2** (not gaps).
- **Placeholders:** `database_id = "PLACEHOLDER..."` is an operational value created in Task 9 (documented), not a code placeholder.
- **Type consistency:** `db.mjs` exports consumed verbatim by `auth.mjs`/`worker.mjs`; `buildDispatch` shape mirrors the current worker plus `courseId`.

## What Plan 2 covers (next)

courseId-parameterized generation scripts reading/writing via new Worker `/internal/course/:id` endpoints; the Cloudflare Cron sweep; Worker serving the per-course onboard/assessment/syllabus/lesson pages from D1; and migrating the existing single `curriculum.json` course into D1.
