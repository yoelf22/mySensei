# mySensei Multi-tenant Plan 2a — Core Course Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a learner able to create a real course from the dashboard and go end-to-end — onboard → placement check → curriculum build → syllabus approval → first lesson → quiz recorded — with **D1 as the single source of truth** and the **Worker serving every course page**, with no `curriculum.json` file and no Cloudflare Pages deploy.

**Architecture:** The GitHub Actions generators stop reading/writing a local `curriculum.json` and stop committing state to git. Instead they read/write one course record through a new **Worker internal API** (`/internal/course/:id`, service-token auth) and push rendered HTML into the D1 `pages` table. The Worker serves those pages at `/c/:id/<slug>` (and renders the static onboard form live). The page renderers gain a `courseId` so their embedded callbacks POST to `/submit` with the `courseId` the Worker already requires. Generation stays scoped to one `courseId`, taken from each `repository_dispatch` payload.

**Tech Stack:** Cloudflare Worker (ESM `.mjs`) + D1, GitHub Actions (Node 20 ESM), Anthropic SDK, nodemailer (Gmail), `vitest` + `@cloudflare/vitest-pool-workers` for Worker tests, `node --test` for pure libs/scripts.

**Scope boundary (what 2a does NOT do):** No hourly **Cron scheduler** — that is Plan 2b. Therefore 2a delivers through **Lesson 1 + its quiz**: Lesson 1 is generated during curriculum build and emailed on approval; subsequent lessons are delivered by the cron in 2b. No specialization/`trackHistory` persistence (deferred to 2b). No migration of an old course (the single-tenant course was already erased).

## Global Constraints

- Worker code is ESM `.mjs` under `worker/`; generators are ESM `.mjs` under `scripts/`; pure libs under `lib/`.
- **No new runtime dependencies.** Worker uses Web platform APIs; scripts may use already-present deps (`@anthropic-ai/sdk`, `nodemailer`) and `node:` built-ins.
- **D1 is the single source of truth per course.** No script reads or writes `curriculum.json`. No workflow commits course state or lesson HTML to git.
- Identity is email lowercased. Active-course cap = 3. Course ids are 12-char base36. D1 binding name is `DB`.
- The Worker↔Actions internal API authenticates with a shared bearer token `INTERNAL_TOKEN` (Worker secret + GitHub Actions secret). It is checked with constant string comparison against `Authorization: Bearer <token>`.
- The Actions reach the Worker via `APP_BASE_URL` (GitHub Actions **variable**, value = the deployed Worker origin `https://mysensei-quiz-helper.yoelf22mysensei.workers.dev`). Callbacks post to `${APP_BASE_URL}/submit`.
- The curriculum **object** shape (the in-memory shape the pure libs and renderers operate on) is unchanged. Its canonical home is the `courses` row columns; `version` is re-added as `1` and `trackHistory` as `[]` on read (no columns for them in 2a); `placement` is persisted inside the `assessment` column.
- All email goes through Gmail via existing scripts; email links point at Worker pages `${APP_BASE_URL}/c/:id/<slug>` (never Cloudflare Pages).
- The `pages` table key is `(course_id, path)`; `path` is a flat slug: `assessment`, `syllabus`, or a lesson base like `lesson-01-attempt1` / `mastery-<ts>`. `onboard` is NOT stored (rendered live).
- `getCourse`, `createCourse`, `listCourses`, `setStatus`, `countActive`, `now`, `randomId`, `isAllowlisted` already exist in `worker/src/db.mjs` and must keep their current signatures.

---

## File Structure

**New files:**
- `worker/src/internal.mjs` — handlers for the `/internal/*` routes (course get/put, page put), plus `internalOk(request, env)` auth check.
- `worker/test/internal.test.mjs` — tests for the internal API + auth.
- `worker/test/serve.test.mjs` — tests for serving `/c/:id/<slug>`.
- `scripts/lib/course-store.mjs` — Node HTTP client used by every generator: `fetchCourse`, `saveCourse`, `savePage`, `submitUrl`.
- `scripts/lib/course-store.test.mjs` — node `--test` for the client (mocked `fetch`).

**Modified files:**
- `worker/src/db.mjs` — add `courseToCurriculum(row)`, `saveCurriculum(env, id, c)`, `getPage(env, courseId, path)`, `putPage(env, courseId, path, html)`.
- `worker/test/db.test.mjs` — add tests for the mapping + page store round-trip.
- `worker/src/worker.mjs` — wire `/internal/*` routes (before `/submit`) and `/c/:id/<slug>` page serving (before the 404); import the new module + `renderOnboardHtml`.
- `lib/render-lesson.mjs`, `lib/render-assessment.mjs`, `lib/render-syllabus.mjs`, `lib/render-onboard.mjs` — accept `courseId`; embed it; post `{ type, courseId, … }` to the submit URL.
- their `lib/render-*.test.mjs` — assert `courseId` + `type` are carried.
- `scripts/onboard.mjs`, `scripts/build-curriculum.mjs`, `scripts/generate-lesson.mjs`, `scripts/record-quiz.mjs`, `scripts/send-syllabus.mjs`, `scripts/send-email.mjs` — take `COURSE_ID`; read/write via `course-store`; store HTML via `savePage`; pass `courseId` + submit URL to renderers.
- `.github/workflows/onboard.yml`, `build-curriculum.yml`, `start-lessons.yml`, `record-quiz.yml` — pass `COURSE_ID`/`APP_BASE_URL`/`INTERNAL_TOKEN`; drop the git-commit-state and Cloudflare-Pages steps; point email links at `/c/:id/<slug>`.

---

## Task 1: Provision the internal-API shared secret (operational)

**Files:** none (operational; documented here so later tasks can assume it exists).

This task creates the shared token the Worker and Actions use. It has no test; it is a prerequisite for Tasks 3–12 working in the live environment. Local Worker tests inject `INTERNAL_TOKEN` directly, so they do not need this.

- [ ] **Step 1: Generate a token and set it as a Worker secret**

```bash
cd worker
TOK=$(openssl rand -hex 32)
printf '%s' "$TOK" | npx wrangler secret put INTERNAL_TOKEN
# keep $TOK for the next step, then: unset TOK
```

- [ ] **Step 2: Set the same value as a GitHub Actions secret, and APP_BASE_URL as a variable**

```bash
printf '%s' "$TOK" | gh secret set INTERNAL_TOKEN
unset TOK
gh variable set APP_BASE_URL --body "https://mysensei-quiz-helper.yoelf22mysensei.workers.dev"
```

- [ ] **Step 3: Confirm**

```bash
cd worker && npx wrangler secret list        # expect INTERNAL_TOKEN present
gh secret list | grep INTERNAL_TOKEN
gh variable list | grep APP_BASE_URL
```

Expected: `INTERNAL_TOKEN` in both secret lists; `APP_BASE_URL` variable set to the Worker origin.

---

## Task 2: D1 curriculum mapping + page store (`db.mjs`)

**Files:**
- Modify: `worker/src/db.mjs`
- Test: `worker/test/db.test.mjs`

**Interfaces:**
- Produces:
  - `courseToCurriculum(row): object|null` — turn a raw `courses` row into the in-memory curriculum object. Re-adds `version:1`, `trackHistory:[]`; splits `placement` back out of the `assessment` column.
  - `saveCurriculum(env, id, c): Promise<void>` — write a curriculum object into the `courses` columns (status taken from `c.progress.status`); folds `c.placement` into the `assessment` column.
  - `getPage(env, courseId, path): Promise<string|null>`
  - `putPage(env, courseId, path, html): Promise<void>` — upsert by `(course_id, path)`.
- Consumes: existing `now()` from this module.

- [ ] **Step 1: Write the failing tests** — append to `worker/test/db.test.mjs`:

```js
import { courseToCurriculum, saveCurriculum, getPage, putPage, createCourse, getCourse } from "../src/db.mjs";

describe("curriculum mapping + pages", () => {
  it("round-trips a curriculum object through the columns", async () => {
    const { id } = await createCourse(env, "me@x.com");
    const c = {
      version: 1, subject: "Taxes", angle: "progressive", startLevel: 6, level: 6,
      settings: { language: "Hebrew", languageCode: "he", chunkMinutes: 10, passThreshold: 0.7 },
      researchContext: "ground", assessment: { questions: [{ q: "a" }] }, placement: { rationale: "mid" },
      outline: [{ id: 1, title: "M1", targetLevel: 7 }],
      progress: { currentModule: 1, attempt: 1, status: "active", delivered: [], lastQuiz: null },
      trackHistory: [],
    };
    await saveCurriculum(env, id, c);
    const back = courseToCurriculum(await rawRow(env, id));
    expect(back.subject).toBe("Taxes");
    expect(back.startLevel).toBe(6);
    expect(back.settings.languageCode).toBe("he");
    expect(back.researchContext).toBe("ground");
    expect(back.assessment.questions[0].q).toBe("a");
    expect(back.placement.rationale).toBe("mid");
    expect(back.outline[0].targetLevel).toBe(7);
    expect(back.progress.currentModule).toBe(1);
    expect(back.version).toBe(1);
    expect(back.trackHistory).toEqual([]);
  });

  it("saveCurriculum sets the status column from progress.status (drives the dashboard + cap)", async () => {
    const { id } = await createCourse(env, "me@x.com");
    await saveCurriculum(env, id, { progress: { status: "awaiting-approval" } });
    const row = await getCourse(env, id);
    expect(row.status).toBe("awaiting-approval");
  });

  it("putPage upserts and getPage reads back the latest html", async () => {
    const { id } = await createCourse(env, "me@x.com");
    expect(await getPage(env, id, "assessment")).toBe(null);
    await putPage(env, id, "assessment", "<h1>one</h1>");
    await putPage(env, id, "assessment", "<h1>two</h1>");
    expect(await getPage(env, id, "assessment")).toBe("<h1>two</h1>");
  });
});

// helper: read the raw row (columns un-parsed) for mapping tests
async function rawRow(env, id) {
  return env.DB.prepare("SELECT * FROM courses WHERE id = ?").bind(id).first();
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- db`
Expected: FAIL (`courseToCurriculum`/`saveCurriculum`/`getPage`/`putPage` not exported).

- [ ] **Step 3: Implement in `worker/src/db.mjs`** — add these exports (keep everything already there):

```js
// Accepts EITHER a raw row (JSON columns as strings, e.g. from a direct
// SELECT) OR a parsed row (JSON columns already objects, e.g. from getCourse).
export function courseToCurriculum(row) {
  if (!row) return null;
  const j = (x) => (typeof x === "string" ? (x ? JSON.parse(x) : null) : (x ?? null));
  const settings = j(row.settings) || {};
  const assessmentCol = j(row.assessment) || {};
  const { placement = null, ...assessment } = assessmentCol;
  return {
    version: 1,
    subject: row.subject || "",
    angle: row.angle || "",
    startLevel: row.start_level,
    level: row.level,
    settings,
    researchContext: row.research || "",
    assessment,
    placement,
    outline: j(row.outline) || [],
    progress: j(row.progress),
    trackHistory: [],
  };
}

export async function saveCurriculum(env, id, c) {
  const assessmentCol = JSON.stringify({ ...(c.assessment || {}), placement: c.placement ?? null });
  const status = (c.progress && c.progress.status) || "draft";
  await env.DB.prepare(
    `UPDATE courses SET subject=?, angle=?, settings=?, status=?, start_level=?, level=?,
       research=?, assessment=?, outline=?, progress=?, updated_at=? WHERE id=?`,
  ).bind(
    c.subject || "", c.angle || "", JSON.stringify(c.settings || {}), status,
    c.startLevel ?? null, c.level ?? null, c.researchContext || "",
    assessmentCol, JSON.stringify(c.outline || []), JSON.stringify(c.progress || null),
    now(), id,
  ).run();
}

export async function getPage(env, courseId, path) {
  const row = await env.DB.prepare("SELECT html FROM pages WHERE course_id=? AND path=?").bind(courseId, path).first();
  return row ? row.html : null;
}

export async function putPage(env, courseId, path, html) {
  await env.DB.prepare(
    `INSERT INTO pages(course_id, path, html, updated_at) VALUES(?,?,?,?)
       ON CONFLICT(course_id, path) DO UPDATE SET html=excluded.html, updated_at=excluded.updated_at`,
  ).bind(courseId, path, html, now()).run();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npm test -- db`
Expected: PASS (all db tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/db.mjs worker/test/db.test.mjs
git commit -m "worker: curriculum<->row mapping + pages get/put in db.mjs"
```

---

## Task 3: Worker internal API (`internal.mjs` + routes)

**Files:**
- Create: `worker/src/internal.mjs`
- Modify: `worker/src/worker.mjs`
- Test: `worker/test/internal.test.mjs`

**Interfaces:**
- Consumes: `getCourse`, `courseToCurriculum`, `saveCurriculum`, `putPage` from `db.mjs`.
- Produces (routed in `worker.mjs`):
  - `GET /internal/course/:id` (bearer `INTERNAL_TOKEN`) → `200` curriculum object, or `404` if no course, `401` if token bad.
  - `PUT /internal/course/:id` (bearer) → body is a curriculum object → `saveCurriculum` → `{ok:true}`.
  - `PUT /internal/course/:id/page` (bearer) → body `{path, html}` → `putPage` → `{ok:true}`.
  - `internalOk(request, env): boolean` exported from `internal.mjs`.

- [ ] **Step 1: Write the failing test** — `worker/test/internal.test.mjs`:

```js
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/worker.mjs";
import { createCourse } from "../src/db.mjs";

const TOKEN = "tok-123";
const E = { ...env, INTERNAL_TOKEN: TOKEN };
async function call(path, init) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://app" + path, init), E, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const auth = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" };

beforeEach(async () => { await env.DB.exec("DELETE FROM courses; DELETE FROM pages;"); });

describe("internal API", () => {
  it("rejects a missing/bad token with 401", async () => {
    const { id } = await createCourse(env, "me@x.com");
    expect((await call(`/internal/course/${id}`, {})).status).toBe(401);
    expect((await call(`/internal/course/${id}`, { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("GET returns the curriculum object; 404 when unknown", async () => {
    const { id } = await createCourse(env, "me@x.com");
    const res = await call(`/internal/course/${id}`, { headers: auth });
    expect(res.status).toBe(200);
    const c = await res.json();
    expect(c.version).toBe(1);
    expect(c.progress.status).toBe("draft");
    expect((await call(`/internal/course/zzzznope1234`, { headers: auth })).status).toBe(404);
  });

  it("PUT course persists, PUT page stores html", async () => {
    const { id } = await createCourse(env, "me@x.com");
    const put = await call(`/internal/course/${id}`, {
      method: "PUT", headers: auth,
      body: JSON.stringify({ subject: "Taxes", level: 6, progress: { status: "active", currentModule: 1 } }),
    });
    expect(put.status).toBe(200);
    const back = await (await call(`/internal/course/${id}`, { headers: auth })).json();
    expect(back.subject).toBe("Taxes");
    expect(back.progress.status).toBe("active");

    const page = await call(`/internal/course/${id}/page`, {
      method: "PUT", headers: auth, body: JSON.stringify({ path: "assessment", html: "<h1>hi</h1>" }),
    });
    expect(page.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- internal`
Expected: FAIL (routes return 404).

- [ ] **Step 3: Implement `worker/src/internal.mjs`**

```js
// worker/src/internal.mjs
import { getCourse, courseToCurriculum, saveCurriculum, putPage } from "./db.mjs";

export function internalOk(request, env) {
  return !!env.INTERNAL_TOKEN && request.headers.get("Authorization") === `Bearer ${env.INTERNAL_TOKEN}`;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

// Handle an /internal/* request. Returns a Response, or null if the path is not internal.
export async function handleInternal(request, env, url) {
  const m = url.pathname.match(/^\/internal\/course\/([a-z0-9]+)(\/page)?$/);
  if (!m) return null;
  if (!internalOk(request, env)) return json({ error: "unauthorized" }, 401);
  const id = m[1];
  const isPage = !!m[2];

  if (isPage && request.method === "PUT") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    if (!body.path || typeof body.html !== "string") return json({ error: "missing path/html" }, 400);
    await putPage(env, id, String(body.path), body.html);
    return json({ ok: true });
  }
  if (isPage) return json({ error: "method not allowed" }, 405);

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

Note: `getCourse` returns a row whose JSON columns are already parsed to objects. `courseToCurriculum` (Task 2) accepts both raw and parsed rows via its `j()` guard, so passing `getCourse`'s result here is correct.

- [ ] **Step 4: Wire the route into `worker/src/worker.mjs`**

Add the import near the top with the other imports:

```js
import { handleInternal } from "./internal.mjs";
```

Inside `fetch`, immediately after the `const method = request.method;` line (before the `/auth/request` block), add:

```js
    const internalRes = await handleInternal(request, env, url);
    if (internalRes) return internalRes;
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd worker && npm test`
Expected: ALL worker tests PASS (internal + the existing suite).

- [ ] **Step 6: Commit**

```bash
git add worker/src/internal.mjs worker/src/worker.mjs worker/test/internal.test.mjs
git commit -m "worker: internal course API (get/put course, put page) with bearer auth"
```

---

## Task 4: Worker serves course pages at `/c/:id/<slug>`

**Files:**
- Modify: `worker/src/worker.mjs`
- Test: `worker/test/serve.test.mjs`

**Interfaces:**
- Consumes: `getCourse`, `getPage` from `db.mjs`; `renderOnboardHtml` from `../../lib/render-onboard.mjs` (pure, Worker-safe).
- Produces routes:
  - `GET /c/:id/onboard` → render the onboard form live (embeds `courseId` + `${APP_BASE_URL}/submit`); `404` if the course doesn't exist.
  - `GET /c/:id/<slug>` (any other slug, e.g. `assessment`, `syllabus`, `lesson-01-attempt1`) → serve stored HTML from `pages`; `404` if absent.

The 12-char base36 `courseId` is the capability for these pages (matching the prior hosted-page model — emailed links open without a session). Owner-invited-friends scale; not session-gated.

- [ ] **Step 1: Write the failing test** — `worker/test/serve.test.mjs`:

```js
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/worker.mjs";
import { createCourse, putPage } from "../src/db.mjs";

const E = { ...env, APP_BASE_URL: "https://app.example" };
async function get(path) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://app" + path), E, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
beforeEach(async () => { await env.DB.exec("DELETE FROM courses; DELETE FROM pages;"); });

describe("serve /c/:id/<slug>", () => {
  it("renders the onboard form live with courseId + submit URL", async () => {
    const { id } = await createCourse(env, "me@x.com");
    const res = await get(`/c/${id}/onboard`);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain(id);                       // courseId embedded
    expect(body).toContain("app.example/submit");     // posts to the submit URL
  });

  it("404s onboard for an unknown course", async () => {
    expect((await get(`/c/zzzznope1234/onboard`)).status).toBe(404);
  });

  it("serves a stored page and 404s an absent one", async () => {
    const { id } = await createCourse(env, "me@x.com");
    await putPage(env, id, "assessment", "<h1>placement</h1>");
    const ok = await get(`/c/${id}/assessment`);
    expect(ok.headers.get("Content-Type")).toContain("text/html");
    expect(await ok.text()).toContain("placement");
    expect((await get(`/c/${id}/lesson-99-attempt9`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- serve`
Expected: FAIL (routes 404 for onboard + assessment).

- [ ] **Step 3: Implement in `worker/src/worker.mjs`**

Add imports near the top:

```js
import { getPage } from "./db.mjs"; // add to the existing db.mjs import list
import { renderOnboardHtml } from "../../lib/render-onboard.mjs";
```

(`getCourse` is already imported; add `getPage` to that same `import { ... } from "./db.mjs"` line rather than a second import.)

Inside `fetch`, **after** the `GET /dashboard` route and **before** the final `return new Response("not found", { status: 404 });`, add (the `html` helper from the dashboard task is already in scope):

```js
    const pm = pathname.match(/^\/c\/([a-z0-9]+)\/(.+)$/);
    if (method === "GET" && pm) {
      const cid = pm[1], slug = pm[2];
      if (slug === "onboard") {
        const row = await getCourse(env, cid);
        if (!row) return new Response("not found", { status: 404 });
        return html(renderOnboardHtml({ webhookUrl: `${env.APP_BASE_URL}/submit`, courseId: cid }));
      }
      const page = await getPage(env, cid, slug);
      if (page == null) return new Response("not found", { status: 404 });
      return html(page);
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npm test`
Expected: ALL worker tests PASS. (This task depends on Task 5's `renderOnboardHtml({ webhookUrl, courseId })` signature — if Task 5 is not yet done, the `courseId` assertion in Step 1 fails. Execute Task 5 first if running out of order; in sequence, Task 5 follows and the onboard test's `id` assertion passes once `renderOnboardHtml` embeds `courseId`.)

> **Sequencing note for the controller:** Task 5 changes `renderOnboardHtml` to accept and embed `courseId`. If you execute strictly in order, write Task 4's code now but expect the `expect(body).toContain(id)` assertion to fail until Task 5 lands. Cleaner: run **Task 5 before Task 4**. The two are otherwise independent. Recommend ordering 5 → 4.

- [ ] **Step 5: Commit**

```bash
git add worker/src/worker.mjs worker/test/serve.test.mjs
git commit -m "worker: serve course pages at /c/:id/<slug> (live onboard + stored pages)"
```

---

## Task 5: Renderers carry `courseId` and post to the submit URL

**Files:**
- Modify: `lib/render-onboard.mjs`, `lib/render-assessment.mjs`, `lib/render-syllabus.mjs`, `lib/render-lesson.mjs`
- Test: `lib/render-onboard.test.mjs`, `lib/render-assessment.test.mjs`, `lib/render-syllabus.test.mjs`, `lib/render-lesson.test.mjs`

**Interfaces (new param + posted body for each):**
- `renderOnboardHtml({ webhookUrl, courseId })` → embedded form POSTs `{ type:"onboard", courseId, subject, email, angle, language, languageCode, chunkMinutes, cadence, deliveryTime, timezone, workweekDays }` to `webhookUrl`.
- `renderAssessmentHtml({ questions, webhookUrl, courseId, languageCode, subject })` → POSTs `{ type:"assessment", courseId, results }`.
- `renderSyllabusHtml({ curriculum, webhookUrl, courseId })` → POSTs `{ type:"approve", courseId }`.
- `renderLessonHtml({ curriculum, lesson, webhookUrl, courseId })` → embedded meta gains `courseId`; quiz POSTs `{ type:"quiz", courseId, module, attempt, score, total, passed, missed }`.

`webhookUrl` now means the full submit endpoint (`…/submit`). In each file: add `courseId` to the destructured params, embed it as a JS literal (`${JSON.stringify(courseId || "")}`), and add `courseId` (and an explicit `type`) to the posted body object.

- [ ] **Step 1: Write the failing tests**

Append to `lib/render-onboard.test.mjs`:

```js
test("onboard form carries courseId and type into the POST body", () => {
  const html = renderOnboardHtml({ webhookUrl: "https://app/submit", courseId: "abc123xyz789" });
  assert.match(html, /abc123xyz789/);
  assert.match(html, /"onboard"/);
});
```

Append to `lib/render-assessment.test.mjs`:

```js
test("assessment carries courseId + type", () => {
  const html = renderAssessmentHtml({ questions: [{ prompt: "q", options: ["a"], answerLevel: 3 }], webhookUrl: "https://app/submit", courseId: "abc123xyz789", languageCode: "en", subject: "S" });
  assert.match(html, /abc123xyz789/);
  assert.match(html, /"assessment"/);
});
```

Append to `lib/render-syllabus.test.mjs`:

```js
test("syllabus approve carries courseId", () => {
  const curriculum = { subject: "S", angle: "a", level: 3, settings: { languageCode: "en" }, outline: [{ id: 1, title: "M1", summary: "s", targetLevel: 4 }] };
  const html = renderSyllabusHtml({ curriculum, webhookUrl: "https://app/submit", courseId: "abc123xyz789" });
  assert.match(html, /abc123xyz789/);
  assert.match(html, /"approve"/);
});
```

Append to `lib/render-lesson.test.mjs` (the file already builds a `curriculum`/`lesson` fixture — reuse it):

```js
test("lesson quiz carries courseId + type into the embedded meta/post", () => {
  const html = renderLessonHtml({ curriculum, lesson, webhookUrl: "https://app/submit", courseId: "abc123xyz789" });
  assert.match(html, /abc123xyz789/);
  assert.match(html, /"quiz"/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test lib/render-onboard.test.mjs lib/render-assessment.test.mjs lib/render-syllabus.test.mjs lib/render-lesson.test.mjs`
Expected: FAIL (the rendered HTML lacks the `courseId` / `type` strings).

- [ ] **Step 3: Edit each renderer**

For each file: (a) add `courseId` to the destructured parameter object; (b) where the embedded script defines the POST body, add `type` + `courseId`.

`lib/render-onboard.mjs` — change the signature to `export function renderOnboardHtml({ webhookUrl, courseId })`, and in the embedded `payload` object literal add as the first field:

```js
courseId: ${JSON.stringify(courseId || "")},
```

(keep the existing `type:"onboard"` and the rest of the fields).

`lib/render-assessment.mjs` — change the signature to `export function renderAssessmentHtml({ questions = [], webhookUrl, courseId, languageCode = "en", subject = "" })`, and change the posted body from `{type:"assessment",results:results}` to:

```js
{type:"assessment",courseId:${JSON.stringify(courseId || "")},results:results}
```

`lib/render-syllabus.mjs` — change the signature to `export function renderSyllabusHtml({ curriculum, webhookUrl, courseId })`, and change the posted body from `{ type:"approve" }` to:

```js
{ type:"approve", courseId:${JSON.stringify(courseId || "")} }
```

`lib/render-lesson.mjs` — change the signature to `export function renderLessonHtml({ curriculum, lesson, webhookUrl, courseId })`; in the `meta` object (serialized into the `<script id="meta">` block) add `courseId: courseId || ""`; and change the quiz POST body from `{ module: meta.module, attempt: meta.attempt, score: score, total: total, passed: passed, missed: missed }` to:

```js
{ type: "quiz", courseId: meta.courseId, module: meta.module, attempt: meta.attempt, score: score, total: total, passed: passed, missed: missed }
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test lib/render-onboard.test.mjs lib/render-assessment.test.mjs lib/render-syllabus.test.mjs lib/render-lesson.test.mjs`
Expected: PASS (including the pre-existing tests in those files).

- [ ] **Step 5: Commit**

```bash
git add lib/render-onboard.mjs lib/render-assessment.mjs lib/render-syllabus.mjs lib/render-lesson.mjs lib/render-onboard.test.mjs lib/render-assessment.test.mjs lib/render-syllabus.test.mjs lib/render-lesson.test.mjs
git commit -m "renderers: embed courseId + explicit type in callback bodies (post to /submit)"
```

---

## Task 6: Generator HTTP client (`scripts/lib/course-store.mjs`)

**Files:**
- Create: `scripts/lib/course-store.mjs`
- Test: `scripts/lib/course-store.test.mjs`

**Interfaces:**
- Produces:
  - `fetchCourse(courseId): Promise<object>` — GET the curriculum object from the Worker; throws on non-2xx.
  - `saveCourse(courseId, curriculum): Promise<void>` — PUT the curriculum object; throws on non-2xx.
  - `savePage(courseId, path, html): Promise<void>` — PUT `{path, html}`; throws on non-2xx.
  - `submitUrl(): string` — `${APP_BASE_URL}/submit` (trailing slash on the base trimmed).
- Consumes env: `APP_BASE_URL`, `INTERNAL_TOKEN`.

- [ ] **Step 1: Write the failing test** — `scripts/lib/course-store.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchCourse, saveCourse, savePage, submitUrl } from "./course-store.mjs";

function setEnv() { process.env.APP_BASE_URL = "https://app.example/"; process.env.INTERNAL_TOKEN = "tok"; }

test("fetchCourse GETs with bearer and returns JSON", async () => {
  setEnv();
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ subject: "S" }), { status: 200 }); };
  const c = await fetchCourse("abc");
  assert.equal(c.subject, "S");
  assert.match(calls[0].url, /\/internal\/course\/abc$/);
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
});

test("saveCourse PUTs the curriculum and throws on non-ok", async () => {
  setEnv();
  let body;
  globalThis.fetch = async (url, init) => { body = JSON.parse(init.body); return new Response("{}", { status: 200 }); };
  await saveCourse("abc", { subject: "S" });
  assert.equal(body.subject, "S");
  globalThis.fetch = async () => new Response("nope", { status: 500 });
  await assert.rejects(() => saveCourse("abc", {}), /saveCourse abc: 500/);
});

test("savePage PUTs {path, html}", async () => {
  setEnv();
  let body;
  globalThis.fetch = async (url, init) => { body = JSON.parse(init.body); return new Response("{}", { status: 200 }); };
  await savePage("abc", "assessment", "<h1>x</h1>");
  assert.equal(body.path, "assessment");
  assert.equal(body.html, "<h1>x</h1>");
});

test("submitUrl trims the trailing slash on the base", () => {
  setEnv();
  assert.equal(submitUrl(), "https://app.example/submit");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/lib/course-store.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `scripts/lib/course-store.mjs`**

```js
// scripts/lib/course-store.mjs
// HTTP client to the Worker internal API. Replaces curriculum.json file I/O.
// Env: APP_BASE_URL (worker origin), INTERNAL_TOKEN (shared secret).
function base() {
  const b = process.env.APP_BASE_URL;
  if (!b) throw new Error("APP_BASE_URL is not set");
  return b.replace(/\/+$/, "");
}
function token() {
  const t = process.env.INTERNAL_TOKEN;
  if (!t) throw new Error("INTERNAL_TOKEN is not set");
  return t;
}

export async function fetchCourse(courseId) {
  const r = await fetch(`${base()}/internal/course/${courseId}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!r.ok) throw new Error(`fetchCourse ${courseId}: ${r.status}`);
  return r.json();
}

export async function saveCourse(courseId, curriculum) {
  const r = await fetch(`${base()}/internal/course/${courseId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(curriculum),
  });
  if (!r.ok) throw new Error(`saveCourse ${courseId}: ${r.status}`);
}

export async function savePage(courseId, path, html) {
  const r = await fetch(`${base()}/internal/course/${courseId}/page`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path, html }),
  });
  if (!r.ok) throw new Error(`savePage ${courseId}/${path}: ${r.status}`);
}

export function submitUrl() {
  return `${base()}/submit`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test scripts/lib/course-store.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/course-store.mjs scripts/lib/course-store.test.mjs
git commit -m "scripts: course-store HTTP client (fetch/save course, save page) for D1 via Worker"
```

---

## Task 7: Convert `scripts/onboard.mjs` to D1

**Files:**
- Modify: `scripts/onboard.mjs`

**Interfaces:**
- Consumes: `saveCourse`, `savePage`, `submitUrl` from `./lib/course-store.mjs`; `process.env.COURSE_ID`.
- Behavior unchanged except: no `curriculum.json`, no `lessons/` file; the partial curriculum is saved to D1 and the assessment HTML is stored as the `assessment` page.

This is an I/O-swap, not a logic change. There is no unit test for this script (it orchestrates Anthropic calls); it is verified by the Task 13 end-to-end smoke. Keep all Anthropic/research/structured logic exactly as-is.

- [ ] **Step 1: Add the import + require COURSE_ID**

At the top of the file, with the other imports, add:

```js
import { saveCourse, savePage, submitUrl } from "./lib/course-store.mjs";
```

After the imports (before `main`), add:

```js
const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }
```

- [ ] **Step 2: Point the renderer at the submit URL + courseId**

Change the `renderAssessmentHtml({ ... })` call so its `webhookUrl` is `submitUrl()` and it passes `courseId`:

```js
const html = renderAssessmentHtml({
  questions,
  webhookUrl: submitUrl(),
  courseId: COURSE_ID,
  languageCode: p.languageCode || "en",
  subject: p.subject,
});
```

- [ ] **Step 3: Replace the HTML file write (current L75) with a page store**

Replace:

```js
fs.writeFileSync(path.join(ROOT, "lessons", "assessment.html"), html);
```

with:

```js
await savePage(COURSE_ID, "assessment", html);
```

Also delete the `lessons/` `mkdirSync` line (no longer needed). If `fs`/`path` become unused after this task's edits, remove their imports.

- [ ] **Step 4: Replace the curriculum write (current L99) with a course save; ensure lifecycle status lives in `progress.status`**

Replace:

```js
fs.writeFileSync(path.join(ROOT, "curriculum.json"), JSON.stringify(curriculum, null, 2) + "\n");
```

with:

```js
await saveCourse(COURSE_ID, curriculum);
```

Ensure the partial curriculum object's `progress.status` is `"awaiting-assessment"` (the Worker derives the `courses.status` column from `progress.status`). If the script currently sets a top-level `status`, move that value to `progress.status`:

```js
progress: { currentModule: 1, attempt: 1, status: "awaiting-assessment", delivered: [], lastQuiz: null },
```

- [ ] **Step 5: Verify it parses + lints clean**

Run: `node --check scripts/onboard.mjs`
Expected: no output (valid). (Full behavior is covered by Task 13.)

- [ ] **Step 6: Commit**

```bash
git add scripts/onboard.mjs
git commit -m "onboard: read/write course + assessment page via D1 (no curriculum.json/lessons file)"
```

---

## Task 8: Convert `scripts/build-curriculum.mjs` to D1

**Files:**
- Modify: `scripts/build-curriculum.mjs`

**Interfaces:**
- Consumes: `fetchCourse`, `saveCourse` from `./lib/course-store.mjs`; `process.env.COURSE_ID`.

I/O-swap only; keep the level-judging + outline-generation logic (and the `progress.status = "active"` it sets) unchanged. Verified by Task 13.

- [ ] **Step 1: Add the import + require COURSE_ID**

```js
import { fetchCourse, saveCourse } from "./lib/course-store.mjs";
```

```js
const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }
```

- [ ] **Step 2: Replace the read seam (current L22)**

Replace:

```js
const curriculum = JSON.parse(fs.readFileSync(file, "utf8"));
```

with:

```js
const curriculum = await fetchCourse(COURSE_ID);
```

(Remove the now-unused `file` constant and `fs`/`path` imports if nothing else uses them. The top-level code must be inside an `async` function or the file must use top-level `await` — this script already runs an `async main()`; keep the `await` inside it.)

- [ ] **Step 3: Replace the write seam (current L88)**

Replace:

```js
fs.writeFileSync(file, JSON.stringify(curriculum, null, 2) + "\n");
```

with:

```js
await saveCourse(COURSE_ID, curriculum);
```

- [ ] **Step 4: Verify it parses**

Run: `node --check scripts/build-curriculum.mjs`
Expected: valid.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-curriculum.mjs
git commit -m "build-curriculum: read/write course via D1"
```

---

## Task 9: Convert `scripts/generate-lesson.mjs` to D1

**Files:**
- Modify: `scripts/generate-lesson.mjs`

**Interfaces:**
- Consumes: `fetchCourse`, `saveCourse`, `savePage`, `submitUrl` from `./lib/course-store.mjs`; `process.env.COURSE_ID`.
- The stored lesson page slug equals the lesson's `fileBase` (e.g. `lesson-01-attempt1`, `mastery-<ts>`). The slug is also recorded in `progress.delivered[].lessonFile` so the emailer can build `${APP_BASE_URL}/c/:id/<slug>`.

I/O-swap only; keep all Anthropic authoring/research/`shouldSendNow`/mastery logic. Verified by Task 13.

- [ ] **Step 1: Add the import + require COURSE_ID**

```js
import { fetchCourse, saveCourse, savePage, submitUrl } from "./lib/course-store.mjs";
```

```js
const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }
```

- [ ] **Step 2: Replace `readCurriculum`/`writeCurriculum` (current L21 / L24)**

Replace the body of `readCurriculum`:

```js
return JSON.parse(fs.readFileSync(path.join(ROOT, "curriculum.json"), "utf8"));
```

with:

```js
return await fetchCourse(COURSE_ID);
```

(make `readCurriculum` `async`, and `await` it at the call site). Replace the body of `writeCurriculum`:

```js
fs.writeFileSync(path.join(ROOT, "curriculum.json"), JSON.stringify(c, null, 2) + "\n");
```

with:

```js
await saveCurriculum_(c);
```

where you add a tiny local wrapper (so the rest of the file's `writeCurriculum(c)` calls become `await writeCurriculum(c)` and the function is `async`):

```js
async function writeCurriculum(c) { await saveCourse(COURSE_ID, c); }
```

(Remove the standalone `saveCurriculum_` reference — just make `writeCurriculum` itself `async` and call `saveCourse`. The point: `writeCurriculum` becomes `async function writeCurriculum(c){ await saveCourse(COURSE_ID, c); }` and every call site uses `await`.)

- [ ] **Step 3: Replace the existence guard (current L225)**

The old guard checked `fs.existsSync(curriculum.json)`. Replace it: wrap the initial `readCurriculum()` in a try/catch — on failure (course unreachable), log and set the no-send output:

```js
let curriculum;
try { curriculum = await readCurriculum(); }
catch (e) { console.log("No course to generate for:", e.message); setOutput({ sent: false, path: "" }); return; }
```

- [ ] **Step 4: Replace the lesson HTML write (current L270) + record the slug; drop `latest.txt`**

Replace:

```js
fs.writeFileSync(path.join(ROOT, relPath), html);
```

with (using the existing `fileBase` as the page slug):

```js
await savePage(COURSE_ID, fileBase, html);
```

When pushing to `progress.delivered`, set `lessonFile` to the slug (not a filesystem path):

```js
curriculum.progress.delivered.push({ module: moduleId, attempt, lessonFile: fileBase, sentAt: new Date().toISOString() });
```

Delete the `latest.txt` write (current L284) entirely — the latest lesson is now `progress.delivered[progress.delivered.length - 1].lessonFile`.

- [ ] **Step 5: Point the renderer at the submit URL + courseId (current L268)**

```js
const html = renderLessonHtml({ curriculum, lesson, webhookUrl: submitUrl(), courseId: COURSE_ID });
```

Remove the `QUIZ_WEBHOOK_URL` env read (current L244) if it is now unused. Keep `setOutput({ sent: true, path: fileBase })`. If `fs`/`path` are now unused, remove their imports.

- [ ] **Step 6: Verify it parses**

Run: `node --check scripts/generate-lesson.mjs`
Expected: valid.

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-lesson.mjs
git commit -m "generate-lesson: read/write course + store lesson page via D1; drop latest.txt"
```

---

## Task 10: Convert `scripts/record-quiz.mjs` to D1

**Files:**
- Modify: `scripts/record-quiz.mjs`

**Interfaces:**
- Consumes: `fetchCourse`, `saveCourse` from `./lib/course-store.mjs`; `process.env.COURSE_ID`.

I/O-swap only; keep the `recordQuiz` call + the stale-result short-circuit. This script is currently top-level (no `async main`); wrap its body in an `async` IIFE so it can `await`. Verified by Task 13.

- [ ] **Step 1: Add the import + require COURSE_ID**

```js
import { fetchCourse, saveCourse } from "./lib/course-store.mjs";
```

```js
const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }
```

- [ ] **Step 2: Wrap the body so it can await, and swap I/O**

Wrap the existing top-level logic in:

```js
(async () => {
  // ... existing logic ...
})().catch((e) => { console.error(e); process.exit(1); });
```

Inside, replace the read (current L24):

```js
const curriculum = JSON.parse(fs.readFileSync(file, "utf8"));
```

with:

```js
const curriculum = await fetchCourse(COURSE_ID);
```

Replace the write (current L48):

```js
fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
```

with:

```js
await saveCourse(COURSE_ID, next);
```

Keep the unchanged-reference stale check (`if (next === curriculum) { console.log("stale quiz result ignored"); return; }`) — it returns from the async IIFE instead of `process.exit(0)`. Remove `fs`/`path`/`file` if now unused.

- [ ] **Step 3: Verify it parses**

Run: `node --check scripts/record-quiz.mjs`
Expected: valid.

- [ ] **Step 4: Commit**

```bash
git add scripts/record-quiz.mjs
git commit -m "record-quiz: read/write course via D1"
```

---

## Task 11: Convert `scripts/send-syllabus.mjs` + `scripts/send-email.mjs` to D1 page links

**Files:**
- Modify: `scripts/send-syllabus.mjs`, `scripts/send-email.mjs`

**Interfaces:**
- Consumes: `fetchCourse`, `savePage`, `submitUrl` from `./lib/course-store.mjs`; `process.env.COURSE_ID`, `process.env.APP_BASE_URL`.
- Email links target Worker pages: syllabus → `${APP_BASE_URL}/c/:id/syllabus`; lesson → `${APP_BASE_URL}/c/:id/<latest delivered lessonFile>`.

I/O-swap + link-target change; keep nodemailer logic. Verified by Task 13.

### send-syllabus.mjs

- [ ] **Step 1: Imports + COURSE_ID**

```js
import { fetchCourse, savePage, submitUrl } from "./lib/course-store.mjs";
const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }
```

- [ ] **Step 2: Read the course + render with courseId (current L16-17)**

Replace the `fs.readFileSync(curriculum.json)` read with `const curriculum = await fetchCourse(COURSE_ID);`, and the render call with:

```js
const html = renderSyllabusHtml({ curriculum, webhookUrl: submitUrl(), courseId: COURSE_ID });
```

- [ ] **Step 3: Store the syllabus page instead of a file (current L20)**

Replace:

```js
fs.writeFileSync(path.join(ROOT, "lessons", "course-syllabus.html"), html);
```

with:

```js
await savePage(COURSE_ID, "syllabus", html);
```

- [ ] **Step 4: Email the Worker page link (replace the LESSONS_BASE_URL / attach-file branch)**

After the `MYSENSEI_RENDER_ONLY` early return, build the link from the Worker and email it (drop the Cloudflare-Pages link and the HTML-attachment fallback entirely):

```js
const link = `${process.env.APP_BASE_URL.replace(/\/+$/, "")}/c/${COURSE_ID}/syllabus`;
await transport.sendMail({
  from, to,
  subject: "mySensei — your course plan is ready",
  text: `Your course plan is ready. Review and approve it here:\n\n${link}\n`,
  html: `<p>Your course plan is ready. Review and approve it here:</p><p><a href="${link}">${link}</a></p>`,
});
```

(Keep reading `MAIL_FROM`/`MAIL_TO`/`GMAIL_APP_PASSWORD` as before; `to` defaults to the course's owner — use `curriculum.settings.email || process.env.MAIL_TO`.)

### send-email.mjs

- [ ] **Step 5: Imports + COURSE_ID**

```js
import { fetchCourse } from "./lib/course-store.mjs";
const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }
```

- [ ] **Step 6: Read the course; find the latest lesson slug; email its Worker link**

Replace the `curriculum.json` read (current L29) with `const curriculum = await fetchCourse(COURSE_ID);` and drop any `latest.txt` read. Build the lesson link from the latest delivered entry:

```js
const delivered = (curriculum.progress && curriculum.progress.delivered) || [];
const latest = delivered[delivered.length - 1];
if (!latest) { console.log("No delivered lesson to email."); process.exit(0); }
const link = `${process.env.APP_BASE_URL.replace(/\/+$/, "")}/c/${COURSE_ID}/${latest.lessonFile}`;
```

Send the email to `curriculum.settings.email || process.env.MAIL_TO` with that `link` (text + html anchor), subject e.g. `"mySensei — your next lesson"`. Keep the nodemailer Gmail transport.

- [ ] **Step 7: Verify both parse**

Run: `node --check scripts/send-syllabus.mjs && node --check scripts/send-email.mjs`
Expected: valid.

- [ ] **Step 8: Commit**

```bash
git add scripts/send-syllabus.mjs scripts/send-email.mjs
git commit -m "syllabus+lesson emails: read course from D1, link to Worker /c/:id pages"
```

---

## Task 12: Re-wire the generation workflows for D1 + courseId

**Files:**
- Modify: `.github/workflows/onboard.yml`, `.github/workflows/build-curriculum.yml`, `.github/workflows/start-lessons.yml`, `.github/workflows/record-quiz.yml`

**Common change:** to EVERY node-running step in these four workflows, add these three env entries (the dispatch payload always carries `courseId` now that the renderers send it):

```yaml
          COURSE_ID: ${{ github.event.client_payload.courseId }}
          APP_BASE_URL: ${{ vars.APP_BASE_URL }}
          INTERNAL_TOKEN: ${{ secrets.INTERNAL_TOKEN }}
```

There is no test; these are CI definitions verified by Task 13. Validate YAML with `python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" <file>` after each edit.

- [ ] **Step 1: `onboard.yml`**
  - Add the three env entries to the `node scripts/onboard.mjs` step.
  - Change the assessment email step's `EMAIL_URL` to `${{ vars.APP_BASE_URL }}/c/${{ github.event.client_payload.courseId }}/assessment` (remove the `vars.LESSONS_BASE_URL/assessment.html` value). Keep `GMAIL_APP_PASSWORD`, `MAIL_FROM`; set `MAIL_TO: ${{ github.event.client_payload.email }}`.
  - **Delete** the Cloudflare Pages deploy step (the one using `secrets.CLOUDFLARE_API_TOKEN`).
  - **Delete** the **"Commit"** step (`git add curriculum.json lessons/ … push`).
  - Remove the `QUIZ_WEBHOOK_URL` env from the onboard step (the script now builds the submit URL from `APP_BASE_URL`).
  - Validate YAML.

- [ ] **Step 2: `build-curriculum.yml`**
  - Add the three env entries to the "Judge level…" (`node scripts/build-curriculum.mjs`) step, the "Generate first lesson" (`npm run generate`) step, and the syllabus step.
  - On the generate step keep `MYSENSEI_FORCE: "1"` and `ANTHROPIC_API_KEY`; remove `QUIZ_WEBHOOK_URL`.
  - Collapse the two syllabus runs into **one** `node scripts/send-syllabus.mjs` step (remove the `MYSENSEI_RENDER_ONLY` render-only run); give it `COURSE_ID`/`APP_BASE_URL`/`INTERNAL_TOKEN` + `GMAIL_APP_PASSWORD`/`MAIL_FROM`/`MAIL_TO`. Remove `LESSONS_BASE_URL` and `QUIZ_WEBHOOK_URL`.
  - **Delete** the Cloudflare Pages deploy step and the **"Commit"** step.
  - Validate YAML.

- [ ] **Step 3: `start-lessons.yml`**
  - Add the three env entries to the `npm run send` (send-email) step; keep `GMAIL_APP_PASSWORD`/`MAIL_FROM`/`MAIL_TO`; remove `LESSONS_BASE_URL`.
  - (No commit/Pages step exists here.)
  - Validate YAML.

- [ ] **Step 4: `record-quiz.yml`**
  - Add the three env entries to the `npm run record` step (keep `QUIZ_MODULE`/`QUIZ_ATTEMPT`/`QUIZ_SCORE`/`QUIZ_TOTAL`/`QUIZ_MISSED`).
  - **Delete** the **"Commit progress"** step (`git add curriculum.json … push`).
  - Validate YAML.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/onboard.yml .github/workflows/build-curriculum.yml .github/workflows/start-lessons.yml .github/workflows/record-quiz.yml
git commit -m "workflows: scope generation to courseId via D1; drop git-state commits + Pages deploys"
```

---

## Task 13: Deploy + end-to-end smoke (operational, owner-run)

**Files:** none (operational).

Prerequisite: Task 1 done (`INTERNAL_TOKEN` on Worker + Actions, `APP_BASE_URL` variable). All code tasks merged to `main` (so the `repository_dispatch` workflows on the default branch are the updated ones).

- [ ] **Step 1: Run the full local suites**

```bash
cd worker && npm test                 # all worker tests green
cd .. && node --test lib/ scripts/lib/   # renderers + course-store green
```

- [ ] **Step 2: Deploy the Worker**

```bash
cd worker && npx wrangler deploy
```

Expected: deploy succeeds; the new `/internal/*` and `/c/:id/*` routes are live.

- [ ] **Step 3: Quick route check (no secrets on the CLI)**

```bash
B=https://mysensei-quiz-helper.yoelf22mysensei.workers.dev
curl -s -o /dev/null -w "internal no-auth -> %{http_code}\n" $B/internal/course/abc   # expect 401
```

- [ ] **Step 4: Browser end-to-end (the real smoke)**
  1. Log in at `/` (allowlisted owner email) → dashboard.
  2. "Start a new course" → redirects to `/c/<id>/onboard`, which now renders the **onboard form** (no longer 404).
  3. Fill subject/email/settings → submit → expect the `onboard` workflow to run (Actions tab) → assessment email arrives linking to `/c/<id>/assessment`.
  4. Open `/c/<id>/assessment`, answer the placement questions → submit → `assessment-result` → `build-curriculum` runs → syllabus email links to `/c/<id>/syllabus`.
  5. Open `/c/<id>/syllabus`, click Approve → `syllabus-approved` → `start-lessons` emails Lesson 1 linking to `/c/<id>/<lesson slug>`.
  6. Open the lesson, answer the quiz → `quiz-result` → `record-quiz` runs.
  7. On `/dashboard`, the course shows an advanced module/level (progress updated).

- [ ] **Step 5: Verify D1 reflects the run**

```bash
cd worker
npx wrangler d1 execute mysensei --remote --json --command "SELECT id, status, level, subject FROM courses ORDER BY updated_at DESC LIMIT 3"
npx wrangler d1 execute mysensei --remote --json --command "SELECT course_id, path FROM pages ORDER BY updated_at DESC LIMIT 10"
```

Expected: the course row advanced; `pages` holds `assessment`, `syllabus`, and a `lesson-…` row for that course.

If any workflow fails, read its run logs (`gh run list`, `gh run view <id> --log-failed`) — the most likely causes are a missing `INTERNAL_TOKEN`/`APP_BASE_URL` on the Actions side or a payload missing `courseId` (means an old renderer is still cached — confirm the Worker was redeployed after Task 5).

---

## Self-Review

**1. Spec coverage (Plan 2a scope = pieces 1–3 of the multi-tenant spec's Plan 2):**
- Worker↔generation bridge (`/internal/course/:id` get/put, page put) → Tasks 2, 3. ✓
- Worker serves course pages from D1 (`/c/:id/<slug>`, live onboard) → Task 4. ✓
- Callbacks keyed by `courseId` (renderers + dispatch already requires it) → Task 5. ✓
- Generation reads/writes via Worker, not `curriculum.json`; no git-state commits; no Pages deploy → Tasks 6–12. ✓
- D1 as source of truth; status/level/subject mirrored to columns for the dashboard → Task 2 (`saveCurriculum`). ✓
- Shared service token → Task 1. ✓
- Deferred (correctly out of 2a): hourly Cron scheduler, specialization/`trackHistory` persistence, old-course migration. Stated in the scope boundary.

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". The script-conversion tasks reference exact current lines (quoted) and give exact replacements; new modules carry complete code; workflow edits name exact steps to add/delete.

**3. Type consistency:**
- `courseToCurriculum`/`saveCurriculum` round-trip the curriculum object; `saveCurriculum` reads `c.progress.status` for the status column — onboard (Task 7) and build (Task 8) set `progress.status`, consistent.
- `webhookUrl` param across all four renderers now means the **submit URL**; every script passes `submitUrl()`; the Worker's live onboard passes `${APP_BASE_URL}/submit` — consistent.
- Page slug contract: `assessment` (Task 7), `syllabus` (Task 11), `lesson-NN-attemptN`/`mastery-<ts>` (Task 9) — served verbatim by Task 4 and linked by Tasks 11/email — consistent.
- `courseToCurriculum` accepts raw OR parsed rows (`j()` guard), so both `getCourse` (parsed, Task 3) and a direct SELECT (raw, Task 2 test) work.

One known limitation carried forward (documented in Global Constraints): `version` and `trackHistory` are reconstructed on read, not persisted; `placement` rides inside the `assessment` column. None are read by the 2a loop. Plan 2b adds columns if specialization needs durable `trackHistory`.

---

## Execution Handoff

**Recommended task order:** 1 → 2 → 3 → **5 → 4** → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. (Task 5 before Task 4, per the sequencing note in Task 4 — the live onboard page asserts the renderer embeds `courseId`.)

Plan complete and saved to `docs/superpowers/plans/2026-06-21-multitenant-plan-2a-core-loop.md`.
