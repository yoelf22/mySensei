# mySensei Plan 2b — Cron Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An hourly Cloudflare Cron on the Worker auto-delivers each active course's next lesson when it is due, without re-sending a lesson the learner hasn't finished.

**Architecture:** The Worker's `scheduled()` handler runs hourly, lists active courses from D1, keeps those where `shouldSendNow(settings, now)` is true, and fires one `lesson-due` `repository_dispatch` per due course. A new `deliver-lesson.yml` Action runs the existing courseId-scoped `generate-lesson` + `send-email`. A new `alreadyDelivered` guard in `generate-lesson` makes the cadence wait for the learner instead of duplicating a lesson.

**Tech Stack:** Cloudflare Worker (ESM `.mjs`) + D1 + Cron Triggers, GitHub Actions (Node 20 ESM), `vitest` + `@cloudflare/vitest-pool-workers`, `node --test` for pure libs.

## Global Constraints

- Worker code is ESM `.mjs` under `worker/`; generators ESM `.mjs` under `scripts/`; pure libs under `lib/`. No new runtime dependencies.
- D1 binding name is `DB`. Cron schedule is exactly `"0 * * * *"` (hourly). The dispatch event type is exactly `lesson-due`, payload `{ courseId }`.
- The Worker dispatches via the GitHub API using `env.GITHUB_TOKEN` / `env.GITHUB_OWNER` / `env.GITHUB_REPO` (same pattern as `worker/src/email.mjs`).
- Actions reach the Worker via `APP_BASE_URL` (variable) + `INTERNAL_TOKEN` (secret); generation also needs `ANTHROPIC_API_KEY` (secret) and email needs `GMAIL_APP_PASSWORD` (secret) + `MAIL_FROM` (variable).
- A `progress.delivered` entry is `{ module, attempt, lessonFile, sentAt }` (note the key is `module`, not `moduleId`). `nextTarget(curriculum)` returns `{ moduleId, attempt, module }`.
- Reuse `lib/schedule.shouldSendNow(settings, now)`, `lib/progress`, and the whole courseId-scoped generation path unchanged except the one guard added here.
- The `scheduled` handler only ever dispatches `active` courses; a course at level 10 has status `awaiting-specialization` (not active), so the cron naturally stops touching it.

---

## File Structure

**New files:**
- `worker/src/sweep.mjs` — `dueCourseIds(courses, now)` (pure) + `runSweep(env, now)` (lists active courses, dispatches due ones).
- `worker/test/sweep.test.mjs` — tests for `dueCourseIds` + `runSweep` + the `scheduled` handler.
- `.github/workflows/deliver-lesson.yml` — `repository_dispatch: [lesson-due]` → generate + send.

**Modified files:**
- `lib/progress.mjs` — add `alreadyDelivered(curriculum, target)`.
- `lib/progress.test.mjs` — add its tests.
- `scripts/generate-lesson.mjs` — use the guard after `nextTarget`.
- `worker/src/db.mjs` — add `listActiveCourses(env)`.
- `worker/test/db.test.mjs` — add its test.
- `worker/src/worker.mjs` — add the `scheduled()` handler to the default export.
- `worker/wrangler.toml` — add the cron trigger.

**Removed:**
- `.github/workflows/cadence.yml` — the old single-tenant manual workflow, superseded by the cron.

**Recommended task order:** 1 → 2 → 3 → 4 → 5 → 6.

---

## Task 1: `alreadyDelivered` guard helper (`lib/progress.mjs`)

**Files:**
- Modify: `lib/progress.mjs`
- Test: `lib/progress.test.mjs`

**Interfaces:**
- Produces: `alreadyDelivered(curriculum, target): boolean` — true when `progress.delivered` already has an entry for `target.moduleId` + `target.attempt`. `target` has the shape `nextTarget` returns (`{ moduleId, attempt }`).

- [ ] **Step 1: Write the failing test** — append to `lib/progress.test.mjs`:

```js
import { alreadyDelivered } from "./progress.mjs";

test("alreadyDelivered matches a delivered lesson by module + attempt", () => {
  const c = { progress: { delivered: [{ module: 1, attempt: 1, lessonFile: "lesson-01-attempt1" }] } };
  assert.equal(alreadyDelivered(c, { moduleId: 1, attempt: 1 }), true);   // same lesson — waiting on the quiz
  assert.equal(alreadyDelivered(c, { moduleId: 1, attempt: 2 }), false);  // re-teach (fail) — fresh
  assert.equal(alreadyDelivered(c, { moduleId: 2, attempt: 1 }), false);  // advanced (pass) — fresh
});

test("alreadyDelivered is false when nothing was delivered yet", () => {
  assert.equal(alreadyDelivered({ progress: {} }, { moduleId: 1, attempt: 1 }), false);
  assert.equal(alreadyDelivered({ progress: { delivered: [] } }, { moduleId: 1, attempt: 1 }), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/progress.test.mjs`
Expected: FAIL (`alreadyDelivered` is not exported).

- [ ] **Step 3: Implement in `lib/progress.mjs`** (add at the end of the file):

```js
/**
 * True when the lesson for this target (module + attempt) has already been
 * delivered — used to make the cadence wait for the learner rather than
 * re-sending the same lesson. `target` is what nextTarget() returns.
 */
export function alreadyDelivered(curriculum, target) {
  const delivered = (curriculum.progress && curriculum.progress.delivered) || [];
  return delivered.some(
    (d) => d.module === target.moduleId && (d.attempt ?? 1) === (target.attempt ?? 1),
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test lib/progress.test.mjs`
Expected: PASS (new tests + the existing suite).

- [ ] **Step 5: Commit**

```bash
git add lib/progress.mjs lib/progress.test.mjs
git commit -m "progress: alreadyDelivered guard (module + attempt)"
```

---

## Task 2: Apply the guard in `scripts/generate-lesson.mjs`

**Files:**
- Modify: `scripts/generate-lesson.mjs`

**Interfaces:**
- Consumes: `alreadyDelivered` from `../lib/progress.mjs`.

The guard sits in the non-mastery branch, right after `nextTarget`. If the current target was already delivered (learner hasn't progressed), the script exits `sent:false` and emails nothing. No unit test (orchestration script) — verified by `node --check` + the Task 6 e2e.

- [ ] **Step 1: Extend the progress import**

The file already imports `{ nextTarget, needsMoreModules, atMastery } from "../lib/progress.mjs"`. Add `alreadyDelivered`:

```js
import { nextTarget, needsMoreModules, atMastery, alreadyDelivered } from "../lib/progress.mjs";
```

- [ ] **Step 2: Add the guard right after `nextTarget`**

In the `else` (non-mastery) branch, immediately after the line
`let { module, moduleId, attempt } = nextTarget(curriculum);`, insert:

```js
    if (alreadyDelivered(curriculum, { moduleId, attempt })) {
      console.log(`Module ${moduleId} attempt ${attempt} already delivered — waiting for the learner's quiz.`);
      setOutput({ sent: false, path: "" });
      return;
    }
```

- [ ] **Step 3: Verify it parses + the guard is present**

Run: `node --check scripts/generate-lesson.mjs && grep -n "alreadyDelivered" scripts/generate-lesson.mjs`
Expected: valid; two matches (import + use).

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-lesson.mjs
git commit -m "generate-lesson: skip when the current lesson was already delivered (wait for the quiz)"
```

---

## Task 3: `listActiveCourses` (`worker/src/db.mjs`)

**Files:**
- Modify: `worker/src/db.mjs`
- Test: `worker/test/db.test.mjs`

**Interfaces:**
- Produces: `listActiveCourses(env): Promise<Array<{id: string, settings: object}>>` — id + parsed settings for every `status = 'active'` course.

- [ ] **Step 1: Write the failing test** — append to `worker/test/db.test.mjs` (inside a new `describe`, before the `rawRow` helper):

```js
import { listActiveCourses, setStatus } from "../src/db.mjs"; // add to the existing db.mjs import lines

describe("listActiveCourses", () => {
  it("returns only active courses with parsed settings", async () => {
    const a = await createCourse(env, "me@x.com");
    const b = await createCourse(env, "me@x.com");
    await saveCurriculum(env, a.id, { settings: { cadence: "daily" }, progress: { status: "active" } });
    await saveCurriculum(env, b.id, { settings: { cadence: "weekly" }, progress: { status: "paused" } });
    const active = await listActiveCourses(env);
    const ids = active.map((c) => c.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
    expect(active.find((c) => c.id === a.id).settings.cadence).toBe("daily");
  });
});
```

(If `createCourse`/`saveCurriculum` are already imported in the file, don't duplicate them — only add `listActiveCourses` to the import list.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- db`
Expected: FAIL (`listActiveCourses` not exported).

- [ ] **Step 3: Implement in `worker/src/db.mjs`** (add near `listCourses`):

```js
export async function listActiveCourses(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, settings FROM courses WHERE status = 'active'",
  ).all();
  return results.map((r) => ({ id: r.id, settings: r.settings ? JSON.parse(r.settings) : {} }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npm test -- db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/db.mjs worker/test/db.test.mjs
git commit -m "worker: listActiveCourses (id + settings of active courses)"
```

---

## Task 4: The sweep + scheduled handler + cron trigger

**Files:**
- Create: `worker/src/sweep.mjs`
- Modify: `worker/src/worker.mjs`, `worker/wrangler.toml`
- Test: `worker/test/sweep.test.mjs`

**Interfaces:**
- Consumes: `shouldSendNow` from `../../lib/schedule.mjs`; `listActiveCourses` from `./db.mjs`; `env.GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO`.
- Produces: `dueCourseIds(courses, now): string[]`; `runSweep(env, now): Promise<{dispatched: string[]}>`; and the Worker `scheduled(event, env, ctx)` handler.

- [ ] **Step 1: Write the failing test** — `worker/test/sweep.test.mjs`:

```js
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../src/worker.mjs";
import { dueCourseIds, runSweep } from "../src/sweep.mjs";
import { createCourse, saveCurriculum } from "../src/db.mjs";

const E = { ...env, GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r" };
const dailyAt = (hh) => ({ cadence: "daily", deliveryTime: `${String(hh).padStart(2, "0")}:00`, timezone: "UTC", workweekDays: [0,1,2,3,4,5,6] });
const NOON_UTC = new Date("2026-06-22T12:00:00Z");

beforeEach(() => { globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })); });

describe("dueCourseIds", () => {
  it("keeps only courses due at this hour", () => {
    const courses = [
      { id: "due1", settings: dailyAt(12) },
      { id: "not1", settings: dailyAt(13) },
    ];
    expect(dueCourseIds(courses, NOON_UTC)).toEqual(["due1"]);
  });
});

describe("runSweep + scheduled", () => {
  beforeEach(async () => { await env.DB.exec("DELETE FROM courses;"); });

  it("dispatches lesson-due only for due active courses", async () => {
    const due = await createCourse(env, "me@x.com");
    const notDue = await createCourse(env, "me@x.com");
    const paused = await createCourse(env, "me@x.com");
    await saveCurriculum(env, due.id, { settings: dailyAt(12), progress: { status: "active" } });
    await saveCurriculum(env, notDue.id, { settings: dailyAt(13), progress: { status: "active" } });
    await saveCurriculum(env, paused.id, { settings: dailyAt(12), progress: { status: "paused" } });

    const res = await runSweep(E, NOON_UTC);
    expect(res.dispatched).toEqual([due.id]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.event_type).toBe("lesson-due");
    expect(body.client_payload.courseId).toBe(due.id);
  });

  it("scheduled() runs the sweep", async () => {
    const due = await createCourse(env, "me@x.com");
    await saveCurriculum(env, due.id, { settings: dailyAt(12), progress: { status: "active" } });
    const ctx = createExecutionContext();
    await worker.scheduled({ scheduledTime: NOON_UTC.getTime(), cron: "0 * * * *" }, E, ctx);
    await waitOnExecutionContext(ctx);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- sweep`
Expected: FAIL (`sweep.mjs` missing; `worker.scheduled` undefined).

- [ ] **Step 3: Implement `worker/src/sweep.mjs`**

```js
// worker/src/sweep.mjs
import { shouldSendNow } from "../../lib/schedule.mjs";
import { listActiveCourses } from "./db.mjs";

// Pure: ids of the courses due to receive a lesson at `now`.
export function dueCourseIds(courses, now) {
  return courses.filter((c) => shouldSendNow(c.settings || {}, now)).map((c) => c.id);
}

async function fireDispatch(env, courseId) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "mySensei-worker",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: "lesson-due", client_payload: { courseId } }),
  });
  if (!res.ok) throw new Error(`lesson-due dispatch failed for ${courseId}: ${res.status}`);
}

export async function runSweep(env, now) {
  const courses = await listActiveCourses(env);
  const due = dueCourseIds(courses, now);
  await Promise.allSettled(due.map((id) => fireDispatch(env, id)));
  return { dispatched: due };
}
```

- [ ] **Step 4: Add the `scheduled` handler to `worker/src/worker.mjs`**

Add the import near the top:

```js
import { runSweep } from "./sweep.mjs";
```

Change the default export from `export default { async fetch(request, env) { … } }` to also carry `scheduled` — add this method alongside `fetch` (sibling property in the same object):

```js
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSweep(env, new Date(event.scheduledTime)));
  },
```

- [ ] **Step 5: Add the cron trigger to `worker/wrangler.toml`**

Append:

```toml
[triggers]
crons = ["0 * * * *"]
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd worker && npm test`
Expected: ALL worker tests PASS (sweep + the existing suite).

- [ ] **Step 7: Commit**

```bash
git add worker/src/sweep.mjs worker/src/worker.mjs worker/wrangler.toml worker/test/sweep.test.mjs
git commit -m "worker: hourly cron sweep dispatches lesson-due for active courses that are due"
```

---

## Task 5: `deliver-lesson.yml` workflow + retire `cadence.yml`

**Files:**
- Create: `.github/workflows/deliver-lesson.yml`
- Remove: `.github/workflows/cadence.yml`

The `lesson-due` dispatch runs `generate-lesson` then, **only if a new lesson was produced**, `send-email`. The `if: steps.gen.outputs.sent == 'true'` gate is essential: when the guard or `shouldSendNow` skips generation, `send-email` must NOT run (it would re-email the previous lesson). No automated test — validated by YAML parse + the Task 6 e2e.

- [ ] **Step 1: Create `.github/workflows/deliver-lesson.yml`**

```yaml
name: deliver-lesson
on:
  repository_dispatch:
    types: [lesson-due]
permissions:
  contents: read
jobs:
  deliver:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm install --no-audit --no-fund
      - name: Generate the next lesson
        id: gen
        env:
          COURSE_ID: ${{ github.event.client_payload.courseId }}
          APP_BASE_URL: ${{ vars.APP_BASE_URL }}
          INTERNAL_TOKEN: ${{ secrets.INTERNAL_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: npm run generate
      - name: Email the lesson
        if: steps.gen.outputs.sent == 'true'
        env:
          COURSE_ID: ${{ github.event.client_payload.courseId }}
          APP_BASE_URL: ${{ vars.APP_BASE_URL }}
          INTERNAL_TOKEN: ${{ secrets.INTERNAL_TOKEN }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
          MAIL_FROM: ${{ vars.MAIL_FROM }}
        run: npm run send
```

- [ ] **Step 2: Validate the YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deliver-lesson.yml'))" && echo OK`
Expected: OK.

- [ ] **Step 3: Confirm `npm run generate` / `npm run send` map to the scripts**

Run: `grep -E '"generate"|"send"' package.json`
Expected: `generate` → `generate-lesson.mjs`, `send` → `send-email.mjs`. (If the script names differ, use the actual `npm run` names from `package.json` here and in the workflow.)

- [ ] **Step 4: Remove the superseded workflow**

Run: `git rm .github/workflows/cadence.yml`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deliver-lesson.yml
git commit -m "workflows: deliver-lesson on lesson-due (generate then send if new); retire cadence.yml"
```

---

## Task 6: Deploy + verify the scheduler (operational, owner-run)

**Files:** none (operational).

Prerequisite: all code tasks merged to `main` (the `lesson-due` workflow must be on the default branch to fire).

- [ ] **Step 1: Run the full suites**

```bash
cd worker && npm test
cd .. && node --test lib/ scripts/lib/
```

- [ ] **Step 2: Deploy the Worker (registers the cron)**

```bash
cd worker && npx wrangler deploy
```

Expected: the deploy output lists the schedule `0 * * * *` under triggers.

- [ ] **Step 3: Confirm the cron trigger is registered**

```bash
npx wrangler deployments list 2>/dev/null | head
# or check the dashboard: Workers → mysensei-quiz-helper → Triggers → Cron
```

- [ ] **Step 4: Manually exercise the delivery path (don't wait an hour)**

Pick an active course id with an unanswered current lesson, and fire a `lesson-due` dispatch by hand to confirm `deliver-lesson` + the guard behave:

```bash
# Should SKIP (already delivered, quiz unanswered) → generate sets sent:false, no email:
gh api repos/<owner>/<repo>/dispatches -f event_type=lesson-due -F client_payload[courseId]=<id>
gh run watch "$(gh run list --workflow=deliver-lesson.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

Then advance that course (answer its quiz so `currentModule`/`attempt` changes) and fire again — this time `generate` should produce a new lesson and `send-email` should email the `/c/:id/<slug>` link. Confirm in the run log (`Sent … to …`) and in D1 (`SELECT path FROM pages WHERE course_id='<id>'`).

- [ ] **Step 5: Let the hourly cron take over**

No action — from here the cron sweeps every hour and delivers due lessons automatically.

---

## Self-Review

**1. Spec coverage:** Cron trigger → Task 4 (wrangler). Worker sweep + `dueCourseIds` + `runSweep` + `scheduled` → Task 4. `listActiveCourses` → Task 3. `deliver-lesson.yml` → Task 5. "Wait" guard (`alreadyDelivered` + generate-lesson use) → Tasks 1–2. Retire `cadence.yml` → Task 5. Testing (pure `dueCourseIds`/`alreadyDelivered`, scheduled handler in the pool) → Tasks 1, 4. Deferred items (invite box, notifications, global ceiling) correctly absent.

**2. Placeholder scan:** No TBD/"add error handling"/"similar to". Each step has complete code or an exact command. Task 5 Step 3 verifies the `npm run` names against `package.json` rather than assuming.

**3. Type consistency:** `dueCourseIds(courses, now)` consumes `[{id, settings}]` — exactly what `listActiveCourses` returns (Task 3) and what the test seeds. `alreadyDelivered(curriculum, {moduleId, attempt})` matches `nextTarget`'s return shape and the `delivered` entry's `{module, attempt}` keys (guarded in Task 1's test). The dispatch event is `lesson-due` consistently in `sweep.mjs`, the test, and `deliver-lesson.yml`. `scheduled` reads `event.scheduledTime` (ms) → `new Date(...)`, matching the test's `scheduledTime: NOON_UTC.getTime()`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-plan-2b-cron-scheduler.md`.
