# mySensei Plan 2b — Cron Scheduler Design

- **Date:** 2026-06-21
- **Status:** Approved (brainstorming) — ready for implementation planning
- **Author:** Yoel + Claude

## Context

Plan 2a made D1 the single source of truth and put the full course loop behind the
Worker: onboard → placement → curriculum → syllabus approval → Lesson 1 → quiz. But it
deferred the **hourly scheduler**, so today lessons after the first never flow on their
own — a learner gets Lesson 1 on approval and nothing more until something dispatches the
next one.

Plan 2b adds that scheduler. It is the cron-only slice of the multi-tenant spec
(`2026-06-21-multi-tenant-design.md` → "Scheduler + generation"). The owner-facing
invite box and send-failure notifications are explicitly **out of scope** (Plan 2c).

## Goal

An hourly Cloudflare Cron on the Worker finds each `active` course that is due now (per
its timezone / cadence / delivery-time / workweek) and delivers its next lesson
automatically — without re-sending a lesson a learner hasn't finished.

## Architecture

The Worker filters to due courses and dispatches only those; the multi-minute Claude
lesson authoring stays in GitHub Actions (Workers can't run that long).

```
Cloudflare Cron (hourly) ─▶ Worker scheduled() ─▶ runSweep(env, now)
                                                      │ list active courses (D1)
                                                      │ keep those where shouldSendNow
                                                      ▼ one dispatch per due course
                                          repository_dispatch  lesson-due {courseId}
                                                      ▼
                                     GitHub Actions: deliver-lesson.yml
                                       generate-lesson (no force) ─▶ send-email
                                       (reads/writes the course via the Worker /internal API)
```

## Components

**1. Cron trigger** — `worker/wrangler.toml` gains:
```toml
[triggers]
crons = ["0 * * * *"]
```
Cloudflare invokes the Worker's `scheduled()` export each hour.

**2. Sweep — `worker/src/sweep.mjs` (new)**
- `dueCourseIds(courses, now): string[]` — pure. Given `[{id, settings}]` and a `Date`,
  returns the ids whose `shouldSendNow(settings, now)` is true. Imports the existing
  `lib/schedule.mjs` (pure, Worker-safe).
- `runSweep(env, now): Promise<{dispatched: string[]}>` — calls `listActiveCourses`,
  computes the due set, and fires one `lesson-due` `repository_dispatch` per due course
  with `client_payload {courseId}`. Uses `env.GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO`.

**3. `worker/src/worker.mjs`** — add the scheduled handler alongside the existing `fetch`:
```js
async scheduled(event, env, ctx) {
  ctx.waitUntil(runSweep(env, new Date(event.scheduledTime)));
}
```

**4. `worker/src/db.mjs`** — add `listActiveCourses(env): Promise<[{id, settings}]>`
(`SELECT id, settings FROM courses WHERE status = 'active'`, settings parsed).

**5. Delivery job — `.github/workflows/deliver-lesson.yml` (new)** — on
`repository_dispatch: types: [lesson-due]`: checkout + Node 20 + `npm install`, then run
`generate-lesson` (no force) and `send-email`, scoped to `COURSE_ID` from the payload,
with env `COURSE_ID`, `APP_BASE_URL` (var), `INTERNAL_TOKEN` (secret),
`ANTHROPIC_API_KEY` (secret), `GMAIL_APP_PASSWORD` (secret), `MAIL_FROM` (var).
`permissions: contents: read`.

**6. The "Wait" guard**
- `lib/progress.mjs` gains `alreadyDelivered(curriculum, target): boolean` — true when
  `progress.delivered` already contains an entry matching `target.moduleId`/`target.attempt`.
- `scripts/generate-lesson.mjs` — right after `nextTarget`, if `alreadyDelivered` is true
  (and not the mastery branch), it exits `setOutput({sent:false, path:""})` and returns.

This makes the cadence "wait" for the learner: a behind learner has unchanged
progress, so the current target is already delivered and is skipped; a quiz pass yields a
new module and a fail yields a new attempt, each a fresh target that passes the guard.

**7. Retire `cadence.yml`** — the old single-tenant, manual/scheduled workflow is
superseded by the cron; remove it.

## Data flow

`runSweep` reads only `id` + `settings` per active course (cheap). The dispatched
`deliver-lesson.yml` does the real work through the existing courseId-scoped path:
`generate-lesson` fetches the course via `/internal`, authors the next lesson (gated by
`shouldSendNow` again and the new `alreadyDelivered` guard), stores the page, updates
`progress.delivered`, and `send-email` emails the `/c/:id/<slug>` link to the owner.

## Error handling

- A generation failure or LLM rate limit fails that one Action; the course's D1 record is
  written only on success, so the next hourly sweep simply retries. No partial state.
- A `lesson-due` dispatch for a course that is no longer due by the time the Action runs
  is caught by `generate-lesson`'s own `shouldSendNow` re-check (belt and suspenders).
- The sweep dispatches independently per course; one failed dispatch does not block others.

## Cost

Bounded by the active-course cap (3 per learner), `shouldSendNow` (a course is due at most
once per cadence period), and the `alreadyDelivered` guard (no re-sends). A global
daily-generation ceiling is **deferred** (not needed at owner-invited-friends scale).

## Testing

- `dueCourseIds(courses, now)` — pure unit tests: due vs not-due by hour, weekday,
  cadence, workweek; mixed sets return only the due ids.
- `alreadyDelivered(curriculum, target)` — pure unit tests: delivered match → true; new
  module or new attempt → false.
- The `scheduled` handler — Workers-pool test: seed D1 with active + paused + not-due
  courses, mock the dispatch `fetch`, invoke `worker.scheduled(...)`, assert it dispatches
  exactly the due `active` courses.

## Reused vs new

- **Reused unchanged:** `lib/schedule`, `lib/progress` (plus the new pure helper), the
  whole courseId-scoped generation path (`generate-lesson`, `send-email`, the `/internal`
  API).
- **New:** the cron trigger, `sweep.mjs`, the `scheduled` handler, `listActiveCourses`,
  `deliver-lesson.yml`, the `alreadyDelivered` guard.

## Out of scope (later)

- Owner "Invite" box on the dashboard + invite email (Plan 2c).
- Owner notification when a send fails (Plan 2c).
- Course archive/delete, post-onboarding settings edits.
- Global daily-generation cost ceiling.
