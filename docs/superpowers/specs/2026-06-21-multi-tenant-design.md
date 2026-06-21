# mySensei — Multi-tenant, multi-course design

- **Date:** 2026-06-21
- **Status:** Approved (brainstorming) — ready for implementation planning
- **Author:** Yoel + Claude

## Context

Today's mySensei is **single-tenant**: a single `curriculum.json` in the repo, GitHub
Actions as the scheduler/runtime, Cloudflare Pages hosting the pages, a Cloudflare
Worker routing form/quiz/approve callbacks into `repository_dispatch`, Gmail for email,
and Claude (Sonnet 4.6) for research, placement, judging, and lessons. It serves one
learner and one active course at a time. A working course (Hebrew, "מיסוי פרוגרסיבי",
level 6, 12-module ladder) is live.

This design evolves it into a **multi-tenant platform**: several learners, each with
several courses, on their own cadences — while keeping the proven per-course pipeline
(onboard → research → placement check → level judging → syllabus approval → lessons with
per-question feedback and missed-concept reinforcement).

## Goals

- Multiple learners, each with multiple courses.
- Invited-friends only; the owner controls who's in; no public signup, no billing.
- Passwordless dashboard where a learner sees and manages their courses.
- A few active courses per learner at once (small cap, default 3); the rest paused.
- Reuse the existing pipeline and pure logic unchanged.
- Keep cost bounded (owner carries LLM cost).

## Non-goals (deferred)

- Public signup, billing/payments, usage-based pricing.
- Org/team structures beyond a flat allowlist.
- Real-time/streaming UI; mobile apps.
- Audio modality (already deferred in v1).

## Requirements (settled in brainstorming)

| Decision | Choice |
|---|---|
| Audience / scale | Me + invited friends (private, no billing, small scale) |
| Access model | Passwordless dashboard (magic link), "My courses" page |
| Concurrency | A few active per learner; small cap (default 3); others paused |
| Invite gate | Owner allowlist — only added emails can log in / onboard |
| Platform | Cloudflare-native (Worker + D1 + Cron); generation stays in GitHub Actions |

## Architecture (Cloudflare-native)

Three roles, each doing what it's best at:

- **Cloudflare Worker — API + hourly Cron.** Handles auth, dashboard data, course
  actions, and the form/quiz/approve callbacks (all keyed by `courseId`). Also **serves
  every web page** directly from D1 (see Web surfaces). Its Cron sweeps active courses
  hourly and fires generation jobs for those due.
- **Cloudflare D1 (serverless SQLite) — the store.** Replaces `curriculum.json` as the
  single source of truth per course.
- **GitHub Actions — the generator.** Keeps doing the ~5-minute Claude work (Workers
  can't run that long). Each job is scoped to one `courseId`, fetches that course from
  the Worker, runs the existing pure logic + renderers, writes results back, and emails
  the course's owner via Gmail.

The pure logic (`lib/progress`, `lib/ladder`, `lib/schedule`, all `render-*`) is
**unchanged** — it already operates on a "curriculum object." The only refactor is that
the generation scripts stop reading a local `curriculum.json` and instead fetch/write one
course record via the Worker's internal API.

### Data model (D1)

```sql
allowlist(email TEXT PRIMARY KEY, added_at TEXT);
learners(email TEXT PRIMARY KEY, created_at TEXT);
courses(
  id TEXT PRIMARY KEY,            -- short random id
  owner_email TEXT NOT NULL,
  subject TEXT, angle TEXT,
  settings TEXT,                  -- JSON: language, languageCode, chunkMinutes, cadence,
                                  --       deliveryTime, timezone, workweekDays, model, passThreshold
  status TEXT,                    -- draft | awaiting-assessment | awaiting-approval |
                                  --        active | paused | completed | awaiting-specialization
  start_level INTEGER, level INTEGER,
  research TEXT,                  -- researchContext
  assessment TEXT,               -- JSON: { questions: [...] }
  outline TEXT,                  -- JSON: [{ id, title, summary, targetLevel }]
  progress TEXT,                 -- JSON: { currentModule, attempt, delivered, lastQuiz }
  last_error TEXT,               -- last generation error (e.g. rate limit), nullable
  created_at TEXT, updated_at TEXT
);
magic_tokens(token TEXT PRIMARY KEY, email TEXT, expires_at TEXT, used INTEGER);
-- Generated page HTML stored per course (lessons/syllabus/assessment), served by the Worker:
pages(course_id TEXT, path TEXT, html TEXT, updated_at TEXT, PRIMARY KEY (course_id, path));
```

Sessions are stateless: a signed JWT cookie (~30-day), no sessions table.

## Auth + dashboard

**Magic-link login:**
1. Learner enters email → `POST /auth/request`.
2. Worker checks `allowlist`. Not listed → friendly "ask the owner for access" (no token,
   no email, no cost). Listed → create a one-time `magic_tokens` row (random token, ~15-min
   expiry), email a `…/auth/verify?token=…` link via Gmail.
3. Learner clicks → `GET /auth/verify` validates (exists, unused, unexpired), marks used,
   sets a signed session cookie, redirects to the dashboard.
4. Every API call carries the cookie; the Worker verifies it and scopes data to that email.

**Dashboard ("My courses"):** a Worker-served page calling `GET /api/courses` (cookie auth),
showing each course's subject, status, level, and progress (module X of N). Actions:
- **Start a new course** → `POST /api/courses` creates a draft row → redirects to the
  onboard form scoped to that `courseId`.
- **Pause / Resume** → `POST /api/courses/:id/pause|resume`; resume enforces the active cap.
- **Open** → the course's latest lesson or syllabus.

## Scheduler + generation

**Hourly sweep (Cloudflare Cron on the Worker):** queries D1 for `active` courses where
`shouldSendNow(settings, now)` is true (the existing timezone/cadence/workweek gate, per
course), and fires a `repository_dispatch` per due course with `{courseId}`.

**Generation jobs (GitHub Actions), scoped to one `courseId`** — the existing flows,
parameterized:
- `onboard` → research + placement questions
- `build-curriculum` → judge level + outline (ladder) + pre-generate Lesson 1
- `start-lessons` (on approve) / `generate-lesson` (cron or after a quiz) → next lesson
  with feedback + missed-concept reinforcement
- `record-quiz` → update progress + missed concepts

Each job: `GET /internal/course/:id` (service-token auth) → run the unchanged pure logic
+ renderers → `POST /internal/course/:id` to persist + store the rendered HTML in `pages`
→ email the owner. Actions↔Worker internal calls use a shared service token (GitHub secret
+ Worker secret).

**Wins:** the git push-race class of bug disappears (D1 is the source of truth, no state
commits). Cost stays bounded: the cron only touches `active` courses; the ~3-active cap
bounds per-learner spend; a global daily-generation ceiling can be added later.

## Web surfaces

The Worker serves **all** pages from D1 — no Cloudflare Pages, no per-lesson deploy step
(which removes the stale-page bug we hit). Routes:
- `/` or `/login` — enter email
- `/dashboard` — the learner's courses (cookie auth)
- `/c/:id/onboard` — subject/angle/settings form (per course)
- `/c/:id/assessment` — placement check
- `/c/:id/syllabus` — syllabus + approve button
- `/c/:id/lesson/:n` — a lesson (with quiz + feedback)

Each page's submit carries its `courseId`, so courses never collide. The existing
renderers gain a `courseId` in the embedded callback payload.

## Migration from the current MVP

Build alongside, then cut over:
1. Stand up D1 + the expanded Worker; seed the current taxation course as the first
   `courses` row; add the owner's emails to `allowlist`.
2. Parameterize the Actions scripts by `courseId` (read/write via the Worker instead of
   `curriculum.json`).
3. Replace `cadence.yml`'s single cron with the Worker Cron sweep.
4. Retire the Cloudflare Pages site (Worker serves pages).
5. Pure libs + renderers carry over unchanged.

## Error handling

- Not allowlisted → friendly message, no email, no cost.
- Magic token expired/used → "request a new link."
- LLM 429 / generation failure → write `last_error`, leave the course state intact (D1
  written only on success), retry on the next cron sweep; surface "delayed" on the dashboard.
- Active-cap exceeded → blocked at start/resume with a clear message.
- Quiz/approve callbacks idempotent by `course + module + attempt` (stale/replayed ignored).
- Email send failure → retried; logged.

## Testing

- Pure libs (`progress`, `ladder`, `schedule`, `render-*`) keep their `node --test` suite
  (unchanged).
- New pure helpers (active-cap check, magic-token validation, status transitions) get unit
  tests.
- Worker API tests (auth, allowlist, course CRUD, cap enforcement) via the Workers test
  tooling against a test D1.
- One scripted end-to-end smoke: allowlist → magic link → start → onboard → assessment →
  build → approve → lesson → quiz, against a local Worker + D1.

## Reused vs new

- **Reused unchanged:** `lib/progress`, `lib/ladder`, `lib/schedule`, `lib/render-lesson`,
  `lib/render-syllabus`, `lib/render-assessment`, `lib/render-onboard`, `lib/claude`; the
  generation flows' core logic.
- **New:** D1 schema + access layer; Worker API (auth, dashboard, course CRUD, page
  serving, internal course read/write); Worker Cron sweep; magic-link auth; the dashboard
  page; courseId-parameterization of the generation scripts; allowlist + cap enforcement.

## Open questions / future

- Exact active-course cap (default 3 — confirm).
- Optional global daily-generation ceiling as a hard cost backstop.
- Course archive/delete from the dashboard.
- Editing a course's settings (cadence/time) post-onboarding.
- If "friends" ever grows to public: revisit billing, abuse controls, and per-tenant rate
  limits (currently out of scope).
