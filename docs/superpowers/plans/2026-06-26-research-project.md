# Research Project Track — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second mySensei track — a Research Project that takes a research question through a Socratic plan dialogue, a Socratic paper draft, downloadable PDF/.docx, and an optional .pptx + browser deck — branching off the existing Course flow at onboarding.

**Architecture:** A research project reuses the `courses` record (marked `kind = "research"`) and all existing sign-in/email/page/dispatch plumbing. Plan/draft versions and the dialogue turns live in one new append-only table `research_artifacts`. New GitHub Action jobs generate the plan, the paper, the export files, and the deck; the worker stays thin (persists artifacts, serves pages, fires dispatches). Generated binary documents live in a new R2 bucket.

**Tech Stack:** Cloudflare Workers + D1 (existing), R2 (new binding), GitHub Actions job scripts (Node 20), `@anthropic-ai/sdk` web-search, and three net-new export libraries: `puppeteer` (HTML→PDF), `docx` (.docx), `pptxgenjs` (.pptx).

## Global Constraints

- **Test runners:** code under `worker/` uses **vitest** (`npm test` in `worker/`, real Miniflare D1 via `import { env } from "cloudflare:test"`); code under `scripts/` and `lib/` uses **`node --test`** (`npm test` at repo root). Migrations are auto-applied to the test D1 by `worker/test/apply-migrations.mjs` — no test-side schema setup.
- **D1 SQL style:** `env.DB.prepare(SQL).bind(...).run()` (writes) / `.first()` (single row, `null` if none) / `.all()` → `{ results }` (multi). Positional `?` only. JSON columns are `JSON.stringify`-ed on write, `JSON.parse`-d on read. Use the existing `now()` and `randomId()` exports from `worker/src/db.mjs`.
- **Internal API auth:** GitHub Action jobs call the worker at `${APP_BASE_URL}/internal/...` with `Authorization: Bearer ${INTERNAL_TOKEN}`. Verified by `internalOk(request, env)` in `worker/src/internal.mjs`.
- **Dispatch shape:** every background job is fired as `POST https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches` with body `{ event_type, client_payload }`. Keep `client_payload` ≤ 10 top-level keys (nest settings under one object, as `onboard` does).
- **Renderers:** import `escapeHtml` and `dirFor` from `lib/render-lesson.mjs` (do not redefine). Reuse the shared design tokens verbatim: `--ink:#1d1b16; --muted:#6b6457; --bg:#faf8f3; --accent:#b4541f; --line:#e7e1d5;`, body font `17px/1.6 Georgia,"Times New Roman",serif`, `main{max-width:42rem}`. Hand server state to inline JS via the JSON-island pattern: `<script id="meta" type="application/json">${JSON.stringify(meta)}</script>`.
- **Models:** dialogue (frequent, cheap) uses `MYSENSEI_MODEL` (default `claude-sonnet-4-6`). Heavy generation (plan, paper sections, deck) uses a new `MYSENSEI_HEAVY_MODEL` (default `claude-opus-4-8`).
- **Real citations only:** references are assembled only from sources actually returned by web search. A claim with no source is flagged in-text, never given an invented reference.
- **Status machine (in `courses.status`):** `planning → plan-talk → drafting → draft-talk → finalizing → final-ready → deck-building → deck-ready`.
- **Commits:** one commit per task, conventional-commit prefix (`feat:`, `test:`, `chore:`). Do not push unless asked. If on `main`, create a branch `feat/research-project` first.

## Prerequisites (do once, before Phase D)

These are external-service / dependency setup steps. Confirm with the owner before running.

1. **R2 bucket** for generated documents:
   - `cd worker && npx wrangler r2 bucket create mysensei-docs`
   - Add to `worker/wrangler.toml`:
     ```toml
     [[r2_buckets]]
     binding = "DOCS"
     bucket_name = "mysensei-docs"
     ```
   - For tests, the vitest Workers pool provides R2 via miniflare; add `r2Buckets: ["DOCS"]` next to `d1Databases` in `worker/vitest.config.mjs`.
2. **New root dependencies** (job scripts): `npm install puppeteer docx pptxgenjs` at repo root. `puppeteer` downloads a Chromium build; the GitHub `ubuntu-latest` runner supports it. The finalize/deck workflows run `npm install` already.
3. **No new secrets** — `ANTHROPIC_API_KEY`, `INTERNAL_TOKEN`, `GMAIL_APP_PASSWORD`, `APP_BASE_URL`, `MAIL_FROM`, `OWNER_EMAIL` already exist as repo secrets/variables.

## File map

**Phase A — data foundation**
- Create `worker/migrations/0006_research.sql` — `kind` column + `research_artifacts` table.
- Modify `worker/src/db.mjs` — research-artifact functions; `kind` in create/save.
- Modify `worker/src/internal.mjs` — `/internal/project/:id/*` routes.
- Modify `scripts/lib/course-store.mjs` — artifact client functions.
- Test `worker/test/research.test.mjs`, `scripts/lib/course-store.test.mjs` (extend).

**Phase B — onboarding branch + project creation**
- Modify `lib/render-onboard.mjs` — Course/Research toggle, payload `kind`.
- Modify `worker/src/dispatch.mjs` — research onboard → `plan-due` dispatch.
- Modify `worker/src/worker.mjs` + `worker/src/pages.mjs` — show `kind` on dashboard, open the right page.
- Test `lib/render-onboard.test.mjs`, `worker/test/dispatch.test.mjs`.

**Phase C — plan stage (generate + Socratic dialogue + regenerate + lock)**
- Modify `lib/claude.mjs` — `researchWithSources`, `heavyModel`.
- Create `lib/render-project.mjs` — the chat-thread page.
- Create `scripts/generate-plan.mjs` — plan v1 + regeneration job.
- Create `scripts/reply-dialogue.mjs` — Socratic reply job.
- Modify `worker/src/worker.mjs` + `dispatch.mjs` — `/submit` message / regenerate / lock.
- Create `.github/workflows/plan.yml`, `.github/workflows/dialogue.yml`.
- Tests for each.

**Phase D — draft stage + finalize (PDF + .docx)**
- Create `lib/render-paper.mjs`, `scripts/generate-paper.mjs`, `scripts/finalize-doc.mjs`.
- Create `lib/paper-docx.mjs`, `lib/paper-pdf.mjs`.
- Modify worker for draft routes, R2 download route.
- Create `.github/workflows/paper.yml`, `.github/workflows/finalize.yml`.

**Phase E — presentation (.pptx + browser deck)**
- Create `lib/deck-model.mjs`, `lib/render-deck.mjs`, `lib/deck-pptx.mjs`, `scripts/generate-deck.mjs`.
- Create `.github/workflows/deck.yml`.

---

# Phase A — Data foundation

### Task A1: Migration — `kind` column + `research_artifacts` table

**Files:**
- Create: `worker/migrations/0006_research.sql`
- Test: `worker/test/research.test.mjs`

**Interfaces:**
- Produces: a `courses.kind TEXT NOT NULL DEFAULT 'course'` column, and a `research_artifacts` table with columns `id, project_id, stage, type, version, role, content, citations, created_at`.

- [ ] **Step 1: Write the migration**

```sql
-- worker/migrations/0006_research.sql
-- A Research Project is a course row marked kind='research'. Its plan/draft
-- versions and the Socratic dialogue turns are append-only rows in
-- research_artifacts (document rows have version+citations; message rows have
-- role+content). Existing courses default to kind='course' and are untouched.
ALTER TABLE courses ADD COLUMN kind TEXT NOT NULL DEFAULT 'course';

CREATE TABLE research_artifacts (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  stage       TEXT NOT NULL,        -- 'plan' | 'draft' | 'final' | 'deck'
  type        TEXT NOT NULL,        -- 'plan' | 'draft' | 'final' | 'deck' | 'message'
  version     INTEGER,              -- document rows: 1,2,...; message rows: NULL
  role        TEXT,                 -- message rows: 'mysensei' | 'user'; documents: NULL
  content     TEXT,                 -- document body (text) or message text
  citations   TEXT,                 -- document rows: JSON [{title,url}]; else NULL
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_artifacts_project ON research_artifacts(project_id, created_at);
```

- [ ] **Step 2: Write the failing test**

```js
// worker/test/research.test.mjs
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createCourse, getCourse } from "../src/db.mjs";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM courses; DELETE FROM research_artifacts;");
});

describe("research migration", () => {
  it("courses default to kind=course", async () => {
    const { id } = await createCourse(env, "me@x.com");
    const got = await getCourse(env, id);
    expect(got.kind).toBe("course");
  });
  it("research_artifacts table exists and is empty", async () => {
    const { results } = await env.DB.prepare("SELECT * FROM research_artifacts").all();
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it passes** (migration auto-applied by the test harness)

Run: `cd worker && npm test -- research`
Expected: both tests PASS (migration is read from `./migrations` by `vitest.config.mjs`).

- [ ] **Step 4: Commit**

```bash
git add worker/migrations/0006_research.sql worker/test/research.test.mjs
git commit -m "feat: research_artifacts table + courses.kind column"
```

---

### Task A2: `db.mjs` — research-artifact functions + `kind` on create/save

**Files:**
- Modify: `worker/src/db.mjs`
- Test: `worker/test/research.test.mjs`

**Interfaces:**
- Consumes: `now()`, `randomId()` (existing exports in `db.mjs`).
- Produces:
  - `createCourse(env, ownerEmail, subject=null, angle=null, kind="course")` → `{ id }` (adds optional `kind`).
  - `setKind(env, id, kind)` → void.
  - `addArtifact(env, { projectId, stage, type, version=null, role=null, content, citations=null })` → `{ id }`.
  - `latestDocument(env, projectId, type)` → row `{ id, version, content, citations(parsed) }` or `null` (highest `version` for that `type`).
  - `listThread(env, projectId, stage)` → array of message rows `{ role, content, created_at }` ascending by `created_at`, only `type='message'` for that `stage`.
  - `getCourse` already returns the new `kind` column automatically (`SELECT *`).

- [ ] **Step 1: Write the failing tests**

```js
// append to worker/test/research.test.mjs
import { createCourse, getCourse, setKind, addArtifact, latestDocument, listThread } from "../src/db.mjs";

describe("research artifacts store", () => {
  it("setKind flips a course to research", async () => {
    const { id } = await createCourse(env, "me@x.com");
    await setKind(env, id, "research");
    expect((await getCourse(env, id)).kind).toBe("research");
  });
  it("createCourse accepts kind directly", async () => {
    const { id } = await createCourse(env, "me@x.com", "Tariffs", "", "research");
    expect((await getCourse(env, id)).kind).toBe("research");
  });
  it("latestDocument returns the highest version", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "research");
    await addArtifact(env, { projectId: id, stage: "plan", type: "plan", version: 1, content: "v1", citations: [{ title: "A", url: "http://a" }] });
    await addArtifact(env, { projectId: id, stage: "plan", type: "plan", version: 2, content: "v2", citations: [] });
    const doc = await latestDocument(env, id, "plan");
    expect(doc.version).toBe(2);
    expect(doc.content).toBe("v2");
  });
  it("latestDocument parses citations and returns null when none", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "research");
    expect(await latestDocument(env, id, "plan")).toBe(null);
    await addArtifact(env, { projectId: id, stage: "plan", type: "plan", version: 1, content: "v1", citations: [{ title: "A", url: "http://a" }] });
    expect((await latestDocument(env, id, "plan")).citations[0].url).toBe("http://a");
  });
  it("listThread returns messages for a stage in order", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "research");
    await addArtifact(env, { projectId: id, stage: "plan", type: "message", role: "mysensei", content: "What is your thesis?" });
    await addArtifact(env, { projectId: id, stage: "plan", type: "message", role: "user", content: "That X causes Y." });
    await addArtifact(env, { projectId: id, stage: "draft", type: "message", role: "user", content: "different stage" });
    const thread = await listThread(env, id, "plan");
    expect(thread.map((m) => m.role)).toEqual(["mysensei", "user"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd worker && npm test -- research`
Expected: FAIL — `setKind is not a function` (and the others).

- [ ] **Step 3: Implement in `worker/src/db.mjs`**

Modify `createCourse` (currently lines 49–56) to accept `kind`:

```js
export async function createCourse(env, ownerEmail, subject = null, angle = null, kind = "course") {
  const id = randomId();
  const t = now();
  await env.DB.prepare(
    "INSERT INTO courses(id, owner_email, status, subject, angle, kind, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)",
  ).bind(id, norm(ownerEmail), "draft", subject, angle, kind, t, t).run();
  return { id };
}
```

Append these new exports (after the page helpers, ~line 137):

```js
export async function setKind(env, id, kind) {
  await env.DB.prepare("UPDATE courses SET kind = ?, updated_at = ? WHERE id = ?").bind(kind, now(), id).run();
}

export async function addArtifact(env, { projectId, stage, type, version = null, role = null, content, citations = null }) {
  const id = randomId();
  await env.DB.prepare(
    "INSERT INTO research_artifacts(id, project_id, stage, type, version, role, content, citations, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
  ).bind(id, projectId, stage, type, version, role, content ?? "", citations ? JSON.stringify(citations) : null, now()).run();
  return { id };
}

export async function latestDocument(env, projectId, type) {
  const row = await env.DB.prepare(
    "SELECT id, version, content, citations FROM research_artifacts WHERE project_id=? AND type=? ORDER BY version DESC LIMIT 1",
  ).bind(projectId, type).first();
  if (!row) return null;
  return { id: row.id, version: row.version, content: row.content, citations: row.citations ? JSON.parse(row.citations) : [] };
}

export async function listThread(env, projectId, stage) {
  const { results } = await env.DB.prepare(
    "SELECT role, content, created_at FROM research_artifacts WHERE project_id=? AND stage=? AND type='message' ORDER BY created_at ASC",
  ).bind(projectId, stage).all();
  return results;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd worker && npm test -- research`
Expected: PASS (all research store tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/db.mjs worker/test/research.test.mjs
git commit -m "feat: research-artifact store functions in db.mjs"
```

---

### Task A3: Internal API + course-store client for artifacts

GitHub Action jobs must read a project, append documents/messages, and read the thread. Add `/internal/project/:id/*` routes and matching Node client functions.

**Files:**
- Modify: `worker/src/internal.mjs`
- Modify: `scripts/lib/course-store.mjs`
- Test: `worker/test/internal.test.mjs` (create), `scripts/lib/course-store.test.mjs` (extend)

**Interfaces:**
- Produces (worker, all gated by `internalOk`):
  - `GET /internal/project/:id` → `{ course: <courseToCurriculum + kind>, planThread, draftThread }`.
  - `POST /internal/project/:id/artifact` body `{ stage, type, version?, role?, content, citations? }` → `{ ok: true, id }`.
- Produces (Node client in `course-store.mjs`):
  - `fetchProject(projectId)` → the GET payload above.
  - `addArtifact(projectId, artifact)` → `{ id }`.

- [ ] **Step 1: Write the failing worker test**

```js
// worker/test/internal.test.mjs
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/worker.mjs";
import { createCourse } from "../src/db.mjs";

const TOK = "test-internal-token";
const withEnv = { ...env, INTERNAL_TOKEN: TOK };
function req(path, method = "GET", body) {
  return new Request("https://w.test" + path, {
    method,
    headers: { Authorization: `Bearer ${TOK}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(async () => { await env.DB.exec("DELETE FROM courses; DELETE FROM research_artifacts;"); });

describe("internal project API", () => {
  it("rejects without the internal token", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "research");
    const res = await worker.fetch(new Request("https://w.test/internal/project/" + id), withEnv);
    expect(res.status).toBe(401);
  });
  it("appends an artifact then returns it in the project payload", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "research");
    const post = await worker.fetch(req(`/internal/project/${id}/artifact`, "POST", { stage: "plan", type: "message", role: "user", content: "hi" }), withEnv);
    expect(post.status).toBe(200);
    const get = await worker.fetch(req(`/internal/project/${id}`), withEnv);
    const payload = await get.json();
    expect(payload.course.kind).toBe("research");
    expect(payload.planThread[0].content).toBe("hi");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd worker && npm test -- internal`
Expected: FAIL — route returns 404/null (not implemented).

- [ ] **Step 3: Implement in `worker/src/internal.mjs`**

Add to the imports at the top: `import { getCourse, courseToCurriculum, addArtifact as dbAddArtifact, listThread } from "./db.mjs";` (merge with the existing import line).

Add this block inside `handleInternal`, before the existing `/internal/course/...` match:

```js
  const pm = url.pathname.match(/^\/internal\/project\/([a-z0-9]+)(\/artifact)?$/);
  if (pm) {
    if (!internalOk(request, env)) return json({ error: "unauthorized" }, 401);
    const pid = pm[1];
    if (pm[2] === "/artifact" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
      if (!body.stage || !body.type) return json({ error: "missing stage/type" }, 400);
      const { id } = await dbAddArtifact(env, {
        projectId: pid, stage: body.stage, type: body.type,
        version: body.version ?? null, role: body.role ?? null,
        content: String(body.content || ""), citations: body.citations ?? null,
      });
      return json({ ok: true, id });
    }
    if (pm[2] === "/artifact") return json({ error: "method not allowed" }, 405);
    if (request.method === "GET") {
      const row = await getCourse(env, pid);
      if (!row) return json({ error: "not found" }, 404);
      return json({
        course: { ...courseToCurriculum(row), kind: row.kind, status: row.status },
        planThread: await listThread(env, pid, "plan"),
        draftThread: await listThread(env, pid, "draft"),
      });
    }
    return json({ error: "method not allowed" }, 405);
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd worker && npm test -- internal`
Expected: PASS.

- [ ] **Step 5: Add the Node client functions to `scripts/lib/course-store.mjs`**

```js
export async function fetchProject(projectId) {
  const r = await fetch(`${base()}/internal/project/${projectId}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!r.ok) throw new Error(`fetchProject ${projectId}: ${r.status}`);
  return r.json();
}

export async function addArtifact(projectId, artifact) {
  const r = await fetch(`${base()}/internal/project/${projectId}/artifact`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(artifact),
  });
  if (!r.ok) throw new Error(`addArtifact ${projectId}: ${r.status}`);
  return r.json();
}
```

- [ ] **Step 6: Commit**

```bash
git add worker/src/internal.mjs worker/test/internal.test.mjs scripts/lib/course-store.mjs
git commit -m "feat: internal project API + course-store artifact client"
```

---

# Phase B — Onboarding branch + project creation

### Task B1: Onboarding form — Course / Research toggle

**Files:**
- Modify: `lib/render-onboard.mjs`
- Test: `lib/render-onboard.test.mjs`

**Interfaces:**
- Produces: the onboard page renders a `kind` radio (`course` default / `research`); when `research` is selected the scheduling fields (`chunkMinutes`, `cadence`, `deliveryTime`, `timezone`) are hidden via JS, and the submit payload includes `kind` and omits scheduling for research. Course mode payload is unchanged.

- [ ] **Step 1: Write the failing test**

```js
// lib/render-onboard.test.mjs  (extend existing file)
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderOnboardHtml } from "./render-onboard.mjs";

test("onboard renders a kind toggle with research option", () => {
  const html = renderOnboardHtml({ webhookUrl: "http://h/submit", courseId: "abc" });
  assert.match(html, /name="kind"/);
  assert.match(html, /value="research"/);
  assert.match(html, /value="course"[^>]*checked/);
});
test("payload-building JS includes kind", () => {
  const html = renderOnboardHtml({ webhookUrl: "http://h/submit", courseId: "abc" });
  assert.match(html, /kind:\s*d\.get\("kind"\)/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test` (root) — or `node --test lib/render-onboard.test.mjs`
Expected: FAIL — no `name="kind"`.

- [ ] **Step 3: Implement in `lib/render-onboard.mjs`**

Add the toggle as the first field inside `<form id="f">` (before the Subject label):

```html
    <label>What do you want to do?</label>
    <div class="row" id="kindrow">
      <label><input type="radio" name="kind" value="course" checked> Take a course</label>
      <label><input type="radio" name="kind" value="research"> Research a question</label>
    </div>
```

Wrap the four scheduling fields (Lesson length, How often, Delivery time, Timezone) in a container so they can be hidden:

```html
    <div id="sched">
      <!-- existing Lesson length / How often / Delivery time / Timezone blocks unchanged -->
    </div>
```

In the inline `<script>`, after `var f = document.getElementById("f")...`, add the show/hide wiring:

```js
  var sched = document.getElementById("sched");
  function syncKind(){
    var research = f.querySelector('input[name=kind]:checked').value === "research";
    sched.style.display = research ? "none" : "";
    document.querySelector('button[type=submit]').textContent = research ? "Start my research" : "Start my course";
  }
  f.querySelectorAll('input[name=kind]').forEach(function(r){ r.addEventListener("change", syncKind); });
  syncKind();
```

In the `payload` object, add `kind: d.get("kind") || "course"` as the first property. (Scheduling fields stay in the payload; for research the worker ignores them — see Task B2.)

- [ ] **Step 4: Run to verify pass**

Run: `node --test lib/render-onboard.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/render-onboard.mjs lib/render-onboard.test.mjs
git commit -m "feat: Course/Research toggle on the onboarding form"
```

---

### Task B2: Dispatch — research onboarding fires `plan-due`

**Files:**
- Modify: `worker/src/dispatch.mjs`
- Test: `worker/test/dispatch.test.mjs` (create)

**Interfaces:**
- Consumes: `buildDispatch(body)` (existing).
- Produces: when `body.type === "onboard"` and `body.kind === "research"`, `buildDispatch` returns `{ event_type: "plan-due", client_payload: { courseId, subject, angle, settings: { language, languageCode, educationLevel, domain } } }` (no scheduling keys). Course onboarding is unchanged.

- [ ] **Step 1: Write the failing test**

```js
// worker/test/dispatch.test.mjs
import { describe, it, expect } from "vitest";
import { buildDispatch } from "../src/dispatch.mjs";

describe("buildDispatch research", () => {
  it("research onboard → plan-due, no scheduling", () => {
    const d = buildDispatch({ type: "onboard", kind: "research", courseId: "abc", subject: "Tariffs and inflation", angle: "US 2025", language: "English", languageCode: "en", educationLevel: "graduate", domain: "economics", cadence: "daily", chunkMinutes: 10 });
    expect(d.event_type).toBe("plan-due");
    expect(d.client_payload.settings.educationLevel).toBe("graduate");
    expect(d.client_payload.settings.cadence).toBeUndefined();
  });
  it("course onboard still maps to onboard event", () => {
    const d = buildDispatch({ type: "onboard", kind: "course", courseId: "abc", subject: "X" });
    expect(d.event_type).toBe("onboard");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd worker && npm test -- dispatch`
Expected: FAIL — research onboard currently returns `event_type: "onboard"`.

- [ ] **Step 3: Implement** — at the top of the `if (type === "onboard")` branch in `buildDispatch`, before the existing course return:

```js
  if (type === "onboard" && body.kind === "research") {
    if (!body.subject) return { error: "missing subject" };
    return { event_type: "plan-due", client_payload: { courseId, subject: body.subject, angle: body.angle || "", settings: { language: body.language || "English", languageCode: body.languageCode || "en", educationLevel: body.educationLevel || "undergraduate", domain: body.domain || "other" } } };
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd worker && npm test -- dispatch`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/dispatch.mjs worker/test/dispatch.test.mjs
git commit -m "feat: research onboarding dispatches plan-due"
```

---

### Task B3: Dashboard — open research projects at their thread page

**Files:**
- Modify: `worker/src/pages.mjs` (the `dashboardPage` `openHref` + render)
- Modify: `worker/src/worker.mjs` (ensure `listCourses` payload carries `kind` — it already does via `parse`, confirm)
- Test: covered by manual + the existing dashboard render; add a unit assertion if `openHref` is extracted.

**Interfaces:**
- Consumes: `/api/courses` returns each course with `kind` (already present — `listCourses` uses `parse(row)` which spreads all columns including `kind`).
- Produces: in `dashboardPage`'s `openHref(c)`, a research project (`c.kind === "research"`) opens `/c/<id>/project`; a course keeps its current target.

- [ ] **Step 1: Locate `openHref` in `worker/src/pages.mjs`** (used at the dashboard `load()` render). Modify it:

```js
function openHref(c){
  if(c.kind==="research") return "/c/"+c.id+"/project";
  // ...existing course logic unchanged...
}
```

If `openHref` does not yet branch on status, keep the existing body as the `else`.

- [ ] **Step 2: Update the course card label** so a research project reads sensibly — in the `load()` map, where the status line is built, add: `var typ=c.kind==="research"?"research · ":"";` and prepend `typ` to the muted status text.

- [ ] **Step 3: Manual verify**

Run: `cd worker && npx wrangler dev` then sign in and confirm a `kind='research'` row (insert one via `wrangler d1 execute`) shows "research ·" and "Open" points to `/c/<id>/project`.

- [ ] **Step 4: Commit**

```bash
git add worker/src/pages.mjs
git commit -m "feat: dashboard opens research projects at their thread page"
```

---

# Phase C — Plan stage (generate, Socratic dialogue, regenerate, lock)

### Task C1: `lib/claude.mjs` — citation-capturing research + heavy model

**Files:**
- Modify: `lib/claude.mjs`
- Test: `lib/claude.test.mjs` (create — pure-function tests on a source extractor)

**Interfaces:**
- Produces:
  - `heavyClient()` / `HEAVY_MODEL` — `process.env.MYSENSEI_HEAVY_MODEL || "claude-opus-4-8"`.
  - `extractSources(content)` — pure function: given a message `content` array, returns deduped `[{ title, url }]` from `web_search_tool_result` blocks and from `text` blocks' `citations`.
  - `researchWithSources(c, prompt, { model })` → `{ text, sources }`. Leaves the existing `research()` untouched.

- [ ] **Step 1: Write the failing test** (extractSources is pure and testable without the network)

```js
// lib/claude.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSources } from "./claude.mjs";

test("extractSources pulls web_search_tool_result urls", () => {
  const content = [
    { type: "server_tool_use", name: "web_search" },
    { type: "web_search_tool_result", content: [
      { type: "web_search_result", url: "https://a.org/x", title: "A" },
      { type: "web_search_result", url: "https://b.org/y", title: "B" },
    ] },
    { type: "text", text: "hello", citations: [
      { type: "web_search_result_location", url: "https://a.org/x", title: "A" },
    ] },
  ];
  const s = extractSources(content);
  assert.equal(s.length, 2); // deduped on url
  assert.deepEqual(s.map((x) => x.url).sort(), ["https://a.org/x", "https://b.org/y"]);
});
test("extractSources tolerates missing fields", () => {
  assert.deepEqual(extractSources([]), []);
  assert.deepEqual(extractSources([{ type: "text", text: "no citations" }]), []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test lib/claude.test.mjs`
Expected: FAIL — `extractSources` not exported.

- [ ] **Step 3: Implement in `lib/claude.mjs`** (append; do not modify `research()`):

```js
export const HEAVY_MODEL = process.env.MYSENSEI_HEAVY_MODEL || "claude-opus-4-8";

// Pull deduped {title,url} from a message's content blocks (web_search results
// and text-block citations). Pure; safe on partial/empty content.
export function extractSources(content) {
  const seen = new Set();
  const out = [];
  const add = (url, title) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ title: title || url, url });
  };
  for (const b of content || []) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r && r.type === "web_search_result") add(r.url, r.title);
    }
    if (b.type === "text" && Array.isArray(b.citations)) {
      for (const ci of b.citations) add(ci.url, ci.title);
    }
  }
  return out;
}

// research(), but also returns the real sources web search surfaced.
export async function researchWithSources(c, prompt, { model = MODEL } = {}) {
  let messages = [{ role: "user", content: prompt }];
  let text = "";
  const sources = [];
  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    const r = await c.messages.create({
      model, max_tokens: 8192,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
      messages,
    });
    text += "\n" + textOf(r);
    for (const s of extractSources(r.content)) if (!seen.has(s.url)) { seen.add(s.url); sources.push(s); }
    if (r.stop_reason !== "pause_turn") break;
    messages = [{ role: "user", content: prompt }, { role: "assistant", content: r.content }];
  }
  return { text: text.trim(), sources };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test lib/claude.test.mjs`
Expected: PASS.

> Note for implementer: the exact `web_search_tool_result` / `citations` field names follow the Anthropic web-search tool surface. If integration testing shows different field names, adjust `extractSources` only — the rest of the pipeline depends only on `{title,url}`. Consult the in-harness `claude-api` skill to confirm the block shape.

- [ ] **Step 5: Commit**

```bash
git add lib/claude.mjs lib/claude.test.mjs
git commit -m "feat: researchWithSources + extractSources + heavy model"
```

---

### Task C2: Plan data model + prompt builder (pure)

Keep the plan's structure as a small pure module so generation and rendering share it and it is unit-testable without the API.

**Files:**
- Create: `lib/plan-model.mjs`
- Test: `lib/plan-model.test.mjs`

**Interfaces:**
- Produces:
  - `PLAN_SCHEMA` — JSON schema for `structured()`: `{ thesis, influences[], sources[], approach: { initialConclusion, researchMethod, confirmationCriteria, fallbacks } }`.
  - `planPrompt({ subject, angle, settings, thread })` → string. `thread` is the prior dialogue (array of `{role,content}`); when present, the prompt instructs the model to revise the plan to reflect it.
  - `planToText(plan)` → readable plain-text rendering of a plan object (used as `content` stored on the artifact and shown in the page).

- [ ] **Step 1: Write the failing test**

```js
// lib/plan-model.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN_SCHEMA, planPrompt, planToText } from "./plan-model.mjs";

test("PLAN_SCHEMA requires the core fields", () => {
  assert.deepEqual(PLAN_SCHEMA.required.sort(), ["approach", "influences", "sources", "thesis"]);
});
test("planPrompt folds in the dialogue when present", () => {
  const p = planPrompt({ subject: "Tariffs", angle: "", settings: { language: "English", educationLevel: "graduate" }, thread: [{ role: "user", content: "Focus on 2025." }] });
  assert.match(p, /Tariffs/);
  assert.match(p, /Focus on 2025\./);
  assert.match(p, /revise/i);
});
test("planToText renders all sections", () => {
  const txt = planToText({ thesis: "T", influences: ["a", "b"], sources: ["s1"], approach: { initialConclusion: "ic", researchMethod: "rm", confirmationCriteria: "cc", fallbacks: "fb" } });
  for (const frag of ["T", "a", "b", "s1", "ic", "rm", "cc", "fb"]) assert.match(txt, new RegExp(frag));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test lib/plan-model.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/plan-model.mjs`**

```js
import { registerDirective } from "./register.mjs";

export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    thesis: { type: "string" },
    influences: { type: "array", items: { type: "string" } },
    sources: { type: "array", items: { type: "string" } },
    approach: {
      type: "object",
      additionalProperties: false,
      properties: {
        initialConclusion: { type: "string" },
        researchMethod: { type: "string" },
        confirmationCriteria: { type: "string" },
        fallbacks: { type: "string" },
      },
      required: ["initialConclusion", "researchMethod", "confirmationCriteria", "fallbacks"],
    },
  },
  required: ["thesis", "influences", "sources", "approach"],
};

export function planPrompt({ subject, angle, settings = {}, thread = [], notes = "" }) {
  const convo = thread.length
    ? `\n\nThe author and you have discussed this. REVISE the plan to reflect the conversation:\n` +
      thread.map((m) => `${m.role === "user" ? "Author" : "You"}: ${m.content}`).join("\n")
    : "";
  return (
    `You are planning a research paper in ${settings.language || "English"} on: "${subject}"` +
    `${angle ? ` (angle: ${angle})` : ""}. ${registerDirective(settings.educationLevel)} ` +
    `Produce a research PLAN with: a sharp thesis; the factors that influence it; where to look for credible sources; ` +
    `and an approach (how you'll reach an initial conclusion, how you'll research it, what criteria confirm it, and fallbacks if it doesn't hold). ` +
    `Ground it in current reality.${notes ? `\n\nResearch notes:\n${notes}` : ""}${convo}`
  );
}

export function planToText(plan) {
  const a = plan.approach || {};
  return [
    `THESIS\n${plan.thesis || ""}`,
    `WHAT INFLUENCES IT\n${(plan.influences || []).map((x) => `• ${x}`).join("\n")}`,
    `WHERE TO LOOK FOR SOURCES\n${(plan.sources || []).map((x) => `• ${x}`).join("\n")}`,
    `APPROACH`,
    `Initial conclusion: ${a.initialConclusion || ""}`,
    `How to research: ${a.researchMethod || ""}`,
    `What confirms it: ${a.confirmationCriteria || ""}`,
    `Fallbacks: ${a.fallbacks || ""}`,
  ].join("\n\n");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test lib/plan-model.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/plan-model.mjs lib/plan-model.test.mjs
git commit -m "feat: plan schema + prompt + text rendering"
```

---

### Task C3: Project page renderer (the chat thread)

**Files:**
- Create: `lib/render-project.mjs`
- Test: `lib/render-project.test.mjs`

**Interfaces:**
- Consumes: `escapeHtml`, `dirFor` from `render-lesson.mjs`.
- Produces: `renderProjectHtml({ courseId, webhookUrl, stage, status, document, thread, downloads })` → full HTML page. Shows the current `document` text at top, the `thread` of messages below, a message box that POSTs `{ type:"dialogue", courseId, stage, text }`, a **Regenerate** button POSTing `{ type:"regenerate", courseId, stage }`, and a **Lock** button POSTing `{ type:"lock", courseId, stage }`. When `status === "final-ready"`, render the `downloads` links and a **Generate presentation** button (`{ type:"deck", courseId }`). All POSTs go to `webhookUrl`.

- [ ] **Step 1: Write the failing test**

```js
// lib/render-project.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderProjectHtml } from "./render-project.mjs";

const base = { courseId: "abc", webhookUrl: "http://h/submit", stage: "plan", status: "plan-talk",
  document: "THESIS\nX causes Y", thread: [{ role: "mysensei", content: "What is your thesis?" }, { role: "user", content: "X causes Y" }], downloads: null };

test("renders the document and the thread", () => {
  const html = renderProjectHtml(base);
  assert.match(html, /X causes Y/);
  assert.match(html, /What is your thesis\?/);
});
test("has message, regenerate and lock controls", () => {
  const html = renderProjectHtml(base);
  assert.match(html, /id="msg"/);
  assert.match(html, /data-act="regenerate"/);
  assert.match(html, /data-act="lock"/);
});
test("shows downloads + deck button when final-ready", () => {
  const html = renderProjectHtml({ ...base, status: "final-ready", downloads: { pdf: "/c/abc/download/pdf", docx: "/c/abc/download/docx" } });
  assert.match(html, /\/c\/abc\/download\/pdf/);
  assert.match(html, /data-act="deck"/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test lib/render-project.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/render-project.mjs`**

Mirror the structure of `lib/render-lesson.mjs` (same `<!doctype>`, the shared `:root` tokens, the JSON-island for state). The distinctive parts:

```js
import { escapeHtml, dirFor } from "./render-lesson.mjs";

export function renderProjectHtml({ courseId, webhookUrl, stage, status, document, thread = [], downloads = null, languageCode = "en" }) {
  const dir = dirFor(languageCode);
  const meta = JSON.stringify({ webhook: webhookUrl, courseId, stage, status });
  const doc = `<pre class="doc">${escapeHtml(document || "")}</pre>`;
  const msgs = thread.map((m) =>
    `<div class="m ${m.role === "user" ? "me" : "ms"}"><b>${m.role === "user" ? "You" : "mySensei"}</b><p>${escapeHtml(m.content).replace(/\n/g, "<br>")}</p></div>`
  ).join("");
  const locked = status === "final-ready" || status === "deck-ready" || status === "deck-building";
  const dl = downloads ? `<p class="dl"><a href="${escapeHtml(downloads.pdf)}">Download PDF</a> · <a href="${escapeHtml(downloads.docx)}">Download Word</a></p>` : "";
  const deckBtn = (status === "final-ready" || status === "deck-ready") ? `<button data-act="deck">Generate presentation</button>` : "";
  const controls = locked ? `${dl}${deckBtn}` : `
    <textarea id="msg" placeholder="Reply to mySensei, or steer the ${stage}..."></textarea>
    <p><button id="send">Send</button>
       <button data-act="regenerate">Regenerate ${stage}</button>
       <button data-act="lock">Lock the ${stage === "plan" ? "plan" : "paper"}</button></p>`;
  return `<!doctype html><html lang="${escapeHtml(languageCode)}" dir="${dir}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>mySensei — research</title>
<style>:root{--ink:#1d1b16;--muted:#6b6457;--bg:#faf8f3;--accent:#b4541f;--line:#e7e1d5;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 Georgia,"Times New Roman",serif}
main{max-width:42rem;margin:0 auto;padding:2rem 1.25rem 4rem}
.doc{white-space:pre-wrap;background:#fff;border:1px solid var(--line);border-radius:.5rem;padding:1rem;font:15px/1.55 system-ui,sans-serif}
.m{margin:1rem 0}.m b{font:bold .8rem system-ui,sans-serif;color:var(--muted)}.m.me p{background:#fff;border:1px solid var(--line);border-radius:.5rem;padding:.6rem .8rem}
textarea{width:100%;min-height:5rem;font:inherit;padding:.6rem;border:1px solid var(--line);border-radius:.4rem}
button{font:inherit;background:var(--accent);color:#fff;border:0;border-radius:.4rem;padding:.6rem 1rem;cursor:pointer;margin:.4rem .4rem 0 0}
.dl a{color:var(--accent)}</style></head>
<body><main>
<h1>Your research ${stage === "plan" ? "plan" : "draft"}</h1>
${doc}
<section id="thread">${msgs}</section>
${controls}
<p id="err" style="color:var(--accent);display:none"></p>
<script id="meta" type="application/json">${meta}</script>
<script>(function(){
  var M=JSON.parse(document.getElementById("meta").textContent);
  var err=document.getElementById("err");
  function post(body){return fetch(M.webhook,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
    .then(function(r){if(!r.ok)throw new Error();return r.json();});}
  var send=document.getElementById("send");
  if(send)send.addEventListener("click",function(){
    var t=document.getElementById("msg").value.trim(); if(!t)return;
    send.disabled=true;
    post({type:"dialogue",courseId:M.courseId,stage:M.stage,text:t}).then(function(){location.reload();})
      .catch(function(){err.textContent="Could not send — try again.";err.style.display="block";send.disabled=false;});
  });
  document.querySelectorAll("button[data-act]").forEach(function(b){
    b.addEventListener("click",function(){
      var act=b.getAttribute("data-act");
      if(act==="lock"&&!confirm("Lock this "+M.stage+"? mySensei will move to the next step."))return;
      b.disabled=true;
      post({type:act,courseId:M.courseId,stage:M.stage}).then(function(){location.reload();})
        .catch(function(){err.textContent="Could not "+act+" — try again.";err.style.display="block";b.disabled=false;});
    });
  });
})();</script>
</main></body></html>`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test lib/render-project.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/render-project.mjs lib/render-project.test.mjs
git commit -m "feat: research project chat-thread page renderer"
```

---

### Task C4: `generate-plan.mjs` job (plan v1 + regeneration)

**Files:**
- Create: `scripts/generate-plan.mjs`
- (No new unit test for the orchestration; it composes already-tested units. A smoke test path is in Step 4.)

**Interfaces:**
- Consumes: `fetchProject`, `addArtifact`, `savePage` (course-store); `client`, `heavyClient`/`HEAVY_MODEL`, `researchWithSources`, `structured` (claude); `PLAN_SCHEMA`, `planPrompt`, `planToText` (plan-model); `renderProjectHtml` (render-project); `setKind`/status via `saveCourse`.
- Env: `COURSE_ID`, `PLAN_PAYLOAD` (JSON `{ subject, angle, settings }`, present only on first generation), `ANTHROPIC_API_KEY`, `APP_BASE_URL`, `INTERNAL_TOKEN`.
- Produces: a new `plan` document artifact at `version = lastVersion + 1`, a saved `project` page, and `courses.status = "plan-talk"`. On first run it also sets `kind = "research"`.

- [ ] **Step 1: Implement `scripts/generate-plan.mjs`**

```js
// Triggered by the "plan-due" repository_dispatch (first plan) and by
// "regenerate" (revised plan). Researches the question, generates/revises the
// plan, appends a plan artifact, renders the thread page, sets status plan-talk.
// Env: COURSE_ID, PLAN_PAYLOAD (first run only), ANTHROPIC_API_KEY, APP_BASE_URL, INTERNAL_TOKEN
import { client, heavyClient, HEAVY_MODEL, researchWithSources, structured } from "../lib/claude.mjs";
import { PLAN_SCHEMA, planPrompt, planToText } from "../lib/plan-model.mjs";
import { renderProjectHtml } from "../lib/render-project.mjs";
import { fetchProject, addArtifact, saveCourse, savePage, submitUrl } from "./lib/course-store.mjs";

const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY is not set."); process.exit(1); }
  const proj = await fetchProject(COURSE_ID);
  const first = !!process.env.PLAN_PAYLOAD;
  const payload = first ? JSON.parse(process.env.PLAN_PAYLOAD) : {
    subject: proj.course.subject, angle: proj.course.angle, settings: proj.course.settings || {},
  };
  const subject = payload.subject, angle = payload.angle || "", settings = payload.settings || {};
  const thread = proj.planThread || [];

  const c = client();
  const { text: notes } = await researchWithSources(c, `Research "${subject}"${angle ? ` (angle: ${angle})` : ""}. Summarize what bears on the thesis and credible source venues. Keep it tight.`, { model: HEAVY_MODEL });
  const plan = await structured(heavyClient(), planPrompt({ subject, angle, settings, thread, notes }), PLAN_SCHEMA, 6000);

  const prev = proj.planThread; // version = count of existing plan docs + 1; derive from server
  const lastVersion = (proj.course.planVersion || 0); // see note below
  const version = (lastVersion || 0) + 1;
  await addArtifact(COURSE_ID, { stage: "plan", type: "plan", version, content: planToText(plan), citations: [] });

  // Persist state: kind=research, status=plan-talk, keep subject/angle/settings.
  const curriculum = { ...proj.course, subject, angle, settings, kind: "research", progress: { ...(proj.course.progress || {}), status: "plan-talk" } };
  await saveCourse(COURSE_ID, curriculum);

  const html = renderProjectHtml({
    courseId: COURSE_ID, webhookUrl: submitUrl(), stage: "plan", status: "plan-talk",
    document: planToText(plan), thread, languageCode: settings.languageCode || "en",
  });
  await savePage(COURSE_ID, "project", html);
  console.log(`Plan v${version} generated for ${COURSE_ID}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

> **Version derivation note:** `version` must be `latestDocument(plan).version + 1`. Expose it cleanly by having `/internal/project/:id` include `planVersion` and `draftVersion` (highest version per type) in the `course` payload. Add that to Task A3's GET handler: compute via `latestDocument(env, pid, "plan")?.version || 0`. Update the A3 test to assert `payload.course.planVersion === 0` initially. (Fold this into A3 when implementing; it is called out here because C4 consumes it.)

- [ ] **Step 2: Wire `saveCourse` to also persist `kind`** — extend `saveCurriculum` (worker `db.mjs`) to write `kind` when present:

In `saveCurriculum`, add `kind=COALESCE(?, kind)` to the UPDATE and bind `c.kind ?? null` (place the bind in the same order). Add a test in `worker/test/research.test.mjs`:

```js
it("saveCurriculum persists kind when provided", async () => {
  const { id } = await createCourse(env, "me@x.com", "T", "", "course");
  const { saveCurriculum } = await import("../src/db.mjs");
  await saveCurriculum(env, id, { subject: "T", kind: "research", progress: { status: "plan-talk" } });
  expect((await getCourse(env, id)).kind).toBe("research");
});
```

- [ ] **Step 3: Run the db test**

Run: `cd worker && npm test -- research`
Expected: PASS.

- [ ] **Step 4: Lint the job by importing it** (no network):

Run: `node -e "import('./scripts/generate-plan.mjs').catch(e=>{if(/COURSE_ID/.test(e.message))process.exit(0);throw e})"` after `COURSE_ID= node ...` — simplest smoke: `node --check scripts/generate-plan.mjs`
Expected: no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-plan.mjs worker/src/db.mjs worker/test/research.test.mjs
git commit -m "feat: generate-plan job + kind persistence in saveCurriculum"
```

---

### Task C5: `reply-dialogue.mjs` job (Socratic reply)

**Files:**
- Create: `scripts/reply-dialogue.mjs`

**Interfaces:**
- Consumes: `fetchProject`, `addArtifact`, `savePage`, `submitUrl`; `client`, `structured`/`textOf` + `messages.create` (Sonnet via `MODEL`); `latestDocument` content via `fetchProject`; `renderProjectHtml`.
- Env: `COURSE_ID`, `STAGE` (`plan`|`draft`), `ANTHROPIC_API_KEY`, `APP_BASE_URL`, `INTERNAL_TOKEN`.
- Behavior: reads the current document + thread for `STAGE`, asks Sonnet for ONE Socratic reply (a probing question / challenge), appends it as a `message` (role `mysensei`), re-renders the page. The user's message was already appended by the worker route (Task C6) before this job fired.

- [ ] **Step 1: Implement `scripts/reply-dialogue.mjs`**

```js
// Triggered by the "dialogue" repository_dispatch. Generates ONE Socratic reply
// to the latest author message for STAGE, appends it, re-renders the page.
// Env: COURSE_ID, STAGE, ANTHROPIC_API_KEY, APP_BASE_URL, INTERNAL_TOKEN
import { client, MODEL, textOf } from "../lib/claude.mjs";
import { renderProjectHtml } from "../lib/render-project.mjs";
import { fetchProject, addArtifact, savePage, submitUrl } from "./lib/course-store.mjs";

const COURSE_ID = process.env.COURSE_ID;
const STAGE = process.env.STAGE === "draft" ? "draft" : "plan";
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY is not set."); process.exit(1); }
  const proj = await fetchProject(COURSE_ID);
  const thread = STAGE === "plan" ? proj.planThread : proj.draftThread;
  const docType = STAGE === "plan" ? "plan" : "draft";
  const docText = proj[docType + "Doc"] || ""; // see note: include latest doc text in the project payload

  const convo = thread.map((m) => `${m.role === "user" ? "Author" : "You"}: ${m.content}`).join("\n");
  const c = client();
  const r = await c.messages.create({
    model: MODEL, max_tokens: 1024,
    messages: [{ role: "user", content:
      `You are a Socratic research mentor. Here is the current ${STAGE}:\n---\n${docText}\n---\n` +
      `Conversation so far:\n${convo}\n\n` +
      `Respond with ONE short, probing reply: challenge a weak assumption, expose a gap, or push the thesis to be sharper. ` +
      `Ask a question or make a pointed observation. Do not rewrite the ${STAGE}; that happens when the author hits Regenerate.` }],
  });
  await addArtifact(COURSE_ID, { stage: STAGE, type: "message", role: "mysensei", content: textOf(r).trim() });

  const fresh = await fetchProject(COURSE_ID);
  const html = renderProjectHtml({
    courseId: COURSE_ID, webhookUrl: submitUrl(), stage: STAGE, status: fresh.course.status,
    document: docText, thread: STAGE === "plan" ? fresh.planThread : fresh.draftThread,
    languageCode: (fresh.course.settings || {}).languageCode || "en",
  });
  await savePage(COURSE_ID, "project", html);
  console.log(`Socratic reply added for ${COURSE_ID} (${STAGE}).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

> **Note:** add `planDoc` and `draftDoc` (the latest document `content` strings) to the `/internal/project/:id` GET payload in Task A3, alongside `planVersion`/`draftVersion`, so jobs and re-renders have the current text without a second round-trip. Update the A3 test accordingly.

- [ ] **Step 2: Syntax check**

Run: `node --check scripts/reply-dialogue.mjs`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/reply-dialogue.mjs
git commit -m "feat: Socratic reply-dialogue job"
```

---

### Task C6: Worker `/submit` routes — dialogue / regenerate / lock

**Files:**
- Modify: `worker/src/worker.mjs` (the `/submit` handler) and `worker/src/dispatch.mjs`
- Test: `worker/test/dispatch.test.mjs`

**Interfaces:**
- Produces in `buildDispatch`: handle `type` ∈ `{dialogue, regenerate, lock, deck}`:
  - `dialogue` → first append the author message (worker does this directly via the internal store before dispatch), then `{ event_type: "dialogue", client_payload: { courseId, stage } }`.
  - `regenerate` → for `stage==="plan"`: `{ event_type: "plan-due", client_payload: { courseId } }` (no PLAN_PAYLOAD ⇒ job reads existing); for `stage==="draft"`: `{ event_type: "paper-due", client_payload: { courseId } }`.
  - `lock` → for `stage==="plan"`: `{ event_type: "paper-due", client_payload: { courseId } }` after setting status `drafting`; for `stage==="draft"`: `{ event_type: "finalize-due", client_payload: { courseId } }` after status `finalizing`.
  - `deck` → `{ event_type: "deck-due", client_payload: { courseId } }`.

- [ ] **Step 1: Write the failing test**

```js
// add to worker/test/dispatch.test.mjs
it("regenerate plan → plan-due", () => {
  expect(buildDispatch({ type: "regenerate", courseId: "abc", stage: "plan" }).event_type).toBe("plan-due");
});
it("lock plan → paper-due", () => {
  expect(buildDispatch({ type: "lock", courseId: "abc", stage: "plan" }).event_type).toBe("paper-due");
});
it("lock draft → finalize-due", () => {
  expect(buildDispatch({ type: "lock", courseId: "abc", stage: "draft" }).event_type).toBe("finalize-due");
});
it("deck → deck-due", () => {
  expect(buildDispatch({ type: "deck", courseId: "abc" }).event_type).toBe("deck-due");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd worker && npm test -- dispatch`
Expected: FAIL.

- [ ] **Step 3: Implement the `buildDispatch` branches** (add before the final quiz fallback):

```js
  if (type === "dialogue") return { event_type: "dialogue", client_payload: { courseId, stage: body.stage === "draft" ? "draft" : "plan" } };
  if (type === "regenerate") return { event_type: body.stage === "draft" ? "paper-due" : "plan-due", client_payload: { courseId } };
  if (type === "lock") return { event_type: body.stage === "draft" ? "finalize-due" : "paper-due", client_payload: { courseId } };
  if (type === "deck") return { event_type: "deck-due", client_payload: { courseId } };
```

- [ ] **Step 4: Implement the worker `/submit` side effects** — in `worker/src/worker.mjs`, inside the `POST /submit` handler, BEFORE the generic `buildDispatch`/dispatch path, add handling that writes to the store for `dialogue` and updates status for `lock`:

```js
      if (body.type === "dialogue") {
        const stage = body.stage === "draft" ? "draft" : "plan";
        const text = String(body.text || "").trim();
        if (!text) return json({ error: "empty message" }, 400, CORS);
        await addArtifact(env, { projectId: String(body.courseId), stage, type: "message", role: "user", content: text });
      }
      if (body.type === "lock") {
        await setStatus(env, String(body.courseId), body.stage === "draft" ? "finalizing" : "drafting");
      }
```

Add `addArtifact` and `setStatus` to the `./db.mjs` import in `worker.mjs` (setStatus already imported; add `addArtifact`).

- [ ] **Step 5: Run to verify pass**

Run: `cd worker && npm test -- dispatch`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/worker.mjs worker/src/dispatch.mjs worker/test/dispatch.test.mjs
git commit -m "feat: dialogue/regenerate/lock/deck submit routes"
```

---

### Task C7: Workflows — `plan.yml` and `dialogue.yml`

**Files:**
- Create: `.github/workflows/plan.yml`, `.github/workflows/dialogue.yml`

**Interfaces:**
- Consumes: the `plan-due` and `dialogue` dispatch events; repo secrets/vars.
- Produces: runs `scripts/generate-plan.mjs` / `scripts/reply-dialogue.mjs`.

- [ ] **Step 1: Create `.github/workflows/plan.yml`** (mirror `onboard.yml`; `plan-due` carries either `{courseId, subject, angle, settings}` on first run or `{courseId}` on regenerate — pass both `PLAN_PAYLOAD` derived from the optional fields and `COURSE_ID`):

```yaml
name: plan
on:
  repository_dispatch:
    types: [plan-due]
permissions:
  contents: read
concurrency:
  group: research-${{ github.event.client_payload.courseId }}
  cancel-in-progress: false
jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm install --no-audit --no-fund
      - name: Generate the plan
        env:
          COURSE_ID: ${{ github.event.client_payload.courseId }}
          PLAN_PAYLOAD: ${{ github.event.client_payload.subject && toJSON(github.event.client_payload) || '' }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          INTERNAL_TOKEN: ${{ secrets.INTERNAL_TOKEN }}
          APP_BASE_URL: ${{ vars.APP_BASE_URL }}
          MYSENSEI_HEAVY_MODEL: ${{ vars.MYSENSEI_HEAVY_MODEL }}
        run: node scripts/generate-plan.mjs
      - name: Notify
        if: success()
        env:
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
          MAIL_FROM: ${{ vars.MAIL_FROM }}
          OWNER_EMAIL: ${{ vars.OWNER_EMAIL }}
          COURSE_ID: ${{ github.event.client_payload.courseId }}
          APP_BASE_URL: ${{ vars.APP_BASE_URL }}
        run: node scripts/notify-ready.mjs plan
      - name: Report failure
        if: failure()
        env:
          COURSE_ID: ${{ github.event.client_payload.courseId }}
          INTERNAL_TOKEN: ${{ secrets.INTERNAL_TOKEN }}
          APP_BASE_URL: ${{ vars.APP_BASE_URL }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
          MAIL_FROM: ${{ vars.MAIL_FROM }}
          OWNER_EMAIL: ${{ vars.OWNER_EMAIL }}
        run: node scripts/report-failure.mjs
```

- [ ] **Step 2: Create `.github/workflows/dialogue.yml`** — identical scaffold, `types: [dialogue]`, same `concurrency.group: research-${{ ... }}`, the job step runs `node scripts/reply-dialogue.mjs` with `STAGE: ${{ github.event.client_payload.stage }}` and `COURSE_ID`. No notify step (the user is on the page).

- [ ] **Step 3: Create `scripts/notify-ready.mjs`** — a small emailer the workflows call; sends the owner (project's recipient) "your <step> is ready" with a sign-in link to `/c/<id>/project`. Mirror `scripts/email-link.mjs` (nodemailer, gmail) but resolve the recipient from the project's `owner_email` via `fetchProject`. Reuse the magic-link request flow if direct sign-in is needed; for v1 the email links to `${APP_BASE_URL}/` (same as `sendInvite`) and the user signs in.

```js
// scripts/notify-ready.mjs  (arg: step name, e.g. "plan" | "paper" | "downloads")
import nodemailer from "nodemailer";
import { fetchProject } from "./lib/course-store.mjs";
const STEP = process.argv[2] || "update";
const COURSE_ID = process.env.COURSE_ID;
async function main() {
  const from = process.env.MAIL_FROM, pass = process.env.GMAIL_APP_PASSWORD;
  if (!from || !pass || !COURSE_ID) { console.log("notify skipped (missing env)"); return; }
  const proj = await fetchProject(COURSE_ID);
  const to = proj.course.ownerEmail; if (!to) { console.log("no recipient"); return; }
  const url = `${process.env.APP_BASE_URL.replace(/\/+$/, "")}/`;
  const t = nodemailer.createTransport({ service: "gmail", auth: { user: from, pass } });
  await t.sendMail({ from, to, subject: `mySensei — your ${STEP} is ready`,
    text: `Your research ${STEP} is ready. Sign in to review it: ${url}\n` });
  console.log("notified", to);
}
main().catch((e) => { console.error(e); process.exit(0); }); // never fail the run
```

- [ ] **Step 4: Syntax check + commit**

Run: `node --check scripts/notify-ready.mjs`

```bash
git add .github/workflows/plan.yml .github/workflows/dialogue.yml scripts/notify-ready.mjs
git commit -m "feat: plan + dialogue workflows and ready-notification email"
```

---

### Task C8: Serve `/c/:id/project` for live re-render fallback

The job saves a `project` page via `savePage`, so the existing `/c/:id/<slug>` stored-page branch already serves `/c/:id/project`. No new route is needed **as long as the page is regenerated on every change** (it is: dialogue, regenerate, and lock all re-render). Verify the existing stored-page branch matches `project` (it matches any slug).

- [ ] **Step 1: Confirm** in `worker/src/worker.mjs` that `pathname.match(/^\/c\/([a-z0-9]+)\/(.+)$/)` serves the stored `project` page. Add a vitest that, after seeding a `pages` row with path `project`, `worker.fetch(GET /c/<id>/project)` returns 200 with the HTML.

```js
// worker/test/serve-project.test.mjs
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/worker.mjs";
import { createCourse, putPage } from "../src/db.mjs";
beforeEach(async () => { await env.DB.exec("DELETE FROM courses; DELETE FROM pages;"); });
it("serves a stored project page", async () => {
  const { id } = await createCourse(env, "me@x.com", "T", "", "research");
  await putPage(env, id, "project", "<h1>Your research plan</h1>");
  const res = await worker.fetch(new Request("https://w.test/c/" + id + "/project"), env);
  expect(res.status).toBe(200);
  expect(await res.text()).toMatch(/Your research plan/);
});
```

- [ ] **Step 2: Run + commit**

Run: `cd worker && npm test -- serve-project`

```bash
git add worker/test/serve-project.test.mjs
git commit -m "test: serve stored research project page"
```

**Phase C checkpoint:** a research project can be created, generate a plan, hold a Socratic dialogue, regenerate, and lock — firing `paper-due`. Phases D and E build the paper and deck.

---

# Phase D — Draft stage + finalize (PDF + .docx)

> Phase D reuses the dialogue/regenerate/lock loop from Phase C (the `draft` stage routes already exist from Task C6). It adds paper generation, the paper renderer, and the export pipeline. Do the **Prerequisites** (R2 bucket + `npm install puppeteer docx pptxgenjs`) before Task D3.

### Task D1: Paper data model + prompt (pure)

**Files:**
- Create: `lib/paper-model.mjs`
- Test: `lib/paper-model.test.mjs`

**Interfaces:**
- Produces:
  - `PAPER_SCHEMA` — `{ title, subtitle, abstract, sections: [{ heading, body }] , conclusion }`.
  - `sectionPrompt({ subject, settings, planText, heading, priorText })` → string (one section at a time, web-search grounded).
  - `outlinePrompt({ planText, settings })` → string producing `{ title, subtitle, abstract, headings: [..], conclusionHint }` (schema `PAPER_OUTLINE_SCHEMA`).
  - `paperToText(paper, references)` → full plain-text paper with a References section built from `references` (`[{title,url}]`).
  - `renderReferences(references)` → numbered list text.

- [ ] **Step 1: Write the failing test**

```js
// lib/paper-model.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAPER_OUTLINE_SCHEMA, outlinePrompt, sectionPrompt, paperToText, renderReferences } from "./paper-model.mjs";

test("outline schema requires title + headings", () => {
  assert.ok(PAPER_OUTLINE_SCHEMA.required.includes("title"));
  assert.ok(PAPER_OUTLINE_SCHEMA.required.includes("headings"));
});
test("sectionPrompt names the heading and grounds in the plan", () => {
  const p = sectionPrompt({ subject: "Tariffs", settings: { language: "English" }, planText: "THESIS X", heading: "Background", priorText: "" });
  assert.match(p, /Background/); assert.match(p, /THESIS X/);
});
test("paperToText includes title, sections, and numbered references", () => {
  const txt = paperToText({ title: "T", subtitle: "S", abstract: "A", sections: [{ heading: "H1", body: "B1" }], conclusion: "C" }, [{ title: "Src", url: "http://s" }]);
  for (const f of ["T", "S", "A", "H1", "B1", "C", "References", "Src", "http://s"]) assert.match(txt, new RegExp(f));
});
test("renderReferences numbers entries", () => {
  assert.match(renderReferences([{ title: "A", url: "http://a" }, { title: "B", url: "http://b" }]), /\[2\] B — http:\/\/b/);
});
```

- [ ] **Step 2: Run to verify failure** → `node --test lib/paper-model.test.mjs` → FAIL.

- [ ] **Step 3: Implement `lib/paper-model.mjs`** (schemas + prompts + `paperToText` joining title/subtitle/abstract/sections/conclusion and appending `\n\nReferences\n` + `renderReferences`). `renderReferences` maps to `[n] ${title} — ${url}`.

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Commit** → `git commit -m "feat: paper model, prompts, references rendering"`.

---

### Task D2: `generate-paper.mjs` job (section-by-section, citations → references)

**Files:**
- Create: `scripts/generate-paper.mjs`

**Interfaces:**
- Consumes: `fetchProject` (gives locked `planDoc` + draft thread), `addArtifact`, `saveCourse`, `savePage`; `heavyClient`, `HEAVY_MODEL`, `researchWithSources`, `structured`; `paper-model`; `render-paper` (Task D4).
- Env: `COURSE_ID`, `ANTHROPIC_API_KEY`, `APP_BASE_URL`, `INTERNAL_TOKEN`.
- Behavior: build outline (`structured`), then for each heading call `researchWithSources` (Opus) to write that section and collect `sources`; merge+dedupe all sources into `references`; assemble `paperToText(paper, references)`; append a `draft` document artifact (`version = draftVersion+1`); set status `draft-talk`; render the project page at `stage="draft"`.

- [ ] **Step 1: Implement** following the `generate-plan.mjs` skeleton, looping over `outline.headings`, accumulating `references` (dedupe by url), storing `citations: references` on the artifact.

- [ ] **Step 2: Syntax check** → `node --check scripts/generate-paper.mjs`.

- [ ] **Step 3: Commit** → `git commit -m "feat: section-by-section paper generation with real references"`.

---

### Task D3: Export libraries — PDF + .docx from paper text

**Files:**
- Create: `lib/paper-pdf.mjs` (HTML→PDF via puppeteer), `lib/paper-docx.mjs` (`docx` lib)
- Create: `lib/render-paper.mjs` (the on-screen paper page + the print HTML used for PDF)
- Test: `lib/paper-docx.test.mjs` (asserts a non-empty Buffer is produced for a small paper — `docx` runs in plain Node)

**Interfaces:**
- Produces:
  - `renderPaperHtml(paper, references)` → reading page (mirrors `render-syllabus.mjs`); `renderPrintHtml(paper, references)` → minimal print-styled HTML for puppeteer.
  - `paperToPdf(paper, references)` → `Promise<Buffer>` (launch puppeteer, `setContent(renderPrintHtml(...))`, `page.pdf({ format: "A4", margin })`).
  - `paperToDocx(paper, references)` → `Promise<Buffer>` (`docx` Document with Title/Heading/Paragraph and a References list; `Packer.toBuffer`).

- [ ] **Step 1: Write the failing docx test**

```js
// lib/paper-docx.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { paperToDocx } from "./paper-docx.mjs";
test("paperToDocx returns a non-empty buffer", async () => {
  const buf = await paperToDocx({ title: "T", subtitle: "S", abstract: "A", sections: [{ heading: "H", body: "B" }], conclusion: "C" }, [{ title: "Src", url: "http://s" }]);
  assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
});
```

- [ ] **Step 2: Run to verify failure** → FAIL (module missing / `docx` not installed). Install: `npm install docx puppeteer pptxgenjs`.

- [ ] **Step 3: Implement `lib/paper-docx.mjs`** using `docx` (`Document`, `Paragraph`, `HeadingLevel`, `TextRun`, `Packer`). Implement `lib/paper-pdf.mjs` with `puppeteer` (`puppeteer.launch({ args: ["--no-sandbox"] })`). Implement `lib/render-paper.mjs` reusing the syllabus renderer's paragraph-splitting + `:root` tokens.

- [ ] **Step 4: Run to verify pass** → `node --test lib/paper-docx.test.mjs` → PASS. (PDF is exercised in CI, not unit-tested, to avoid bundling Chromium in the fast suite.)

- [ ] **Step 5: Commit** → `git commit -m "feat: PDF + docx + paper page renderers"`.

---

### Task D4: R2 storage + download route + `finalize-doc.mjs` job

**Files:**
- Modify: `worker/wrangler.toml` (R2 binding — see Prerequisites), `worker/vitest.config.mjs` (test R2)
- Modify: `worker/src/internal.mjs` (PUT `/internal/project/:id/file/:fmt` → stores bytes in R2), `worker/src/worker.mjs` (GET `/c/:id/download/:fmt` → streams from R2 with auth)
- Create: `scripts/finalize-doc.mjs`
- Create: `.github/workflows/paper.yml`, `.github/workflows/finalize.yml`
- Test: `worker/test/download.test.mjs`

**Interfaces:**
- Produces:
  - Internal `PUT /internal/project/:id/file/:fmt` (`fmt` ∈ `pdf|docx|pptx`), body = raw bytes, `Content-Type` set by caller → `env.DOCS.put(`${id}/${fmt}`, body)`; records a `final`/`deck` artifact noting availability.
  - Public `GET /c/:id/download/:fmt` → requires `sessionEmail` === the project owner, streams `env.DOCS.get(`${id}/${fmt}`)` with the right `Content-Type` + `Content-Disposition: attachment`.
  - `scripts/finalize-doc.mjs`: fetch project → latest `draft` doc + references → `paperToPdf` + `paperToDocx` → PUT both files → set status `final-ready` → re-render `project` page with `downloads`.

- [ ] **Step 1: Write the failing download test**

```js
// worker/test/download.test.mjs
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/worker.mjs";
import { createCourse } from "../src/db.mjs";
beforeEach(async () => { await env.DB.exec("DELETE FROM courses;"); });
it("owner downloads a stored pdf; stranger gets 404/403", async () => {
  const { id } = await createCourse(env, "me@x.com", "T", "", "research");
  await env.DOCS.put(`${id}/pdf`, "PDFBYTES");
  // (session cookie wiring mirrors existing auth tests; assert the route exists and gates by owner)
  const res = await worker.fetch(new Request("https://w.test/c/" + id + "/download/pdf"), env);
  expect([401, 403]).toContain(res.status); // unauthenticated
});
```

- [ ] **Step 2: Run to verify failure** → route missing.

- [ ] **Step 3: Implement** the internal PUT (R2 `put`), the public GET (owner check via `sessionEmail` + `getCourse(...).owner_email`, stream `r2obj.body`), add `DOCS` to test config. Implement `scripts/finalize-doc.mjs` and the two workflows (`paper.yml` → `node scripts/generate-paper.mjs`; `finalize.yml` → `node scripts/finalize-doc.mjs`, both with the standard scaffold + a `notify-ready` step). Add a Node client `putFile(projectId, fmt, buffer, contentType)` to `scripts/lib/course-store.mjs`.

- [ ] **Step 4: Run to verify pass** → `cd worker && npm test -- download` → PASS.

- [ ] **Step 5: Commit** → `git commit -m "feat: R2 storage, gated download route, finalize job + workflows"`.

**Phase D checkpoint:** lock-the-plan → paper generated → draft dialogue/regenerate/lock → PDF + .docx downloadable from the project page.

---

# Phase E — Presentation (.pptx + browser deck)

### Task E1: Deck model (pure)

**Files:**
- Create: `lib/deck-model.mjs`
- Test: `lib/deck-model.test.mjs`

**Interfaces:**
- Produces: `DECK_SCHEMA` — `{ slides: [{ heading, point, notes }] }`; `deckPrompt({ paperText, settings })` → string ("each slide: a heading, ONE main learning as the on-slide point, and presenter notes carrying the narrative").

- [ ] **Step 1: Test** that `DECK_SCHEMA.required` includes `slides` and each slide requires `heading, point, notes`; `deckPrompt` mentions "presenter notes".
- [ ] **Step 2–4:** implement, run, commit (`feat: deck model + prompt`).

---

### Task E2: Deck renderers — `.pptx` + browser deck

**Files:**
- Create: `lib/deck-pptx.mjs` (`pptxgenjs`), `lib/render-deck.mjs` (browser slideshow with a speaker-notes view)
- Test: `lib/deck-pptx.test.mjs` (non-empty Buffer), `lib/render-deck.test.mjs` (HTML contains each heading + a notes panel)

**Interfaces:**
- Produces: `deckToPptx({ slides })` → `Promise<Buffer>` (`new pptxgenjs()`, one slide per item, `slide.addText(heading/point)`, `slide.addNotes(notes)`, `pptx.write("nodebuffer")`); `renderDeckHtml({ slides, courseId })` → self-contained HTML deck (arrow-key navigation, toggle speaker notes).

- [ ] **Steps:** write failing tests, install already done, implement, run, commit (`feat: pptx + browser deck renderers`).

---

### Task E3: `generate-deck.mjs` job + `deck.yml`

**Files:**
- Create: `scripts/generate-deck.mjs`, `.github/workflows/deck.yml`

**Interfaces:**
- Behavior: fetch project → latest `draft` doc text → `structured(heavyClient, deckPrompt, DECK_SCHEMA)` → `deckToPptx` (PUT to R2 as `pptx`) + `renderDeckHtml` (savePage at slug `deck`) → record `deck` artifact → status `deck-ready` → re-render `project` page (now showing a .pptx download + "open browser deck" linking `/c/:id/deck`).
- The `deck-due` dispatch + the project page's **Generate presentation** button already exist (Tasks C6, C3).

- [ ] **Steps:** implement the job (mirror finalize), `deck.yml` (standard scaffold, `node scripts/generate-deck.mjs`, notify-ready "presentation"), syntax check, commit (`feat: deck generation job + workflow`).

**Phase E checkpoint:** from a finalized paper, "Generate presentation" produces a downloadable `.pptx` and a browser deck with presenter notes.

---

## Self-Review (completed against the spec)

- **Onboarding toggle / hide scheduling / no quiz** → Tasks B1, B2 (research onboard maps straight to `plan-due`; no assessment job in the research path). ✓
- **Event-driven, email only notifies** → no cron involvement; `notify-ready.mjs` (C7) is the only email, fired by job completion. ✓
- **Socratic dialogue, talk-then-regenerate, version history** → C3 (page), C5 (reply job), C6 (routes), append-only `research_artifacts` with `version` (A1/A2). ✓
- **Plan content (thesis/influences/sources/approach + fallbacks)** → `PLAN_SCHEMA` (C2). ✓
- **Paper structure title→references, real sources** → `PAPER_SCHEMA` + `researchWithSources` + `renderReferences` (C1, D1, D2). ✓
- **PDF + .docx** → D3, D4. **`.pptx` + browser deck with presenter notes** → E1–E3. ✓
- **Reuse course record (`kind`), one artifacts table** → A1/A2. ✓
- **Model split (Sonnet dialogue / Opus heavy)** → C1 (`HEAVY_MODEL`), used in C4/D2/E3; dialogue uses `MODEL` (C5). ✓
- **Out of scope (no re-open after lock, single citation style, no collaboration)** → not built; `lock` is terminal for each stage. ✓

**Gaps surfaced for the owner (beyond the approved spec — decide before Phase D):**
1. The spec said "reuse the existing markdown→PDF path" — **none exists**; this plan builds export net-new with `puppeteer`/`docx`/`pptxgenjs`.
2. Binary documents need storage — this plan **adds an R2 bucket** (`mysensei-docs`).
3. `extractSources` depends on the exact web-search block field names; confirm against the live tool during C1 integration.
