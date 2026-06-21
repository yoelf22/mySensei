# mySensei

A personal tutor that teaches you any subject, one browser-ready lesson at a time.

Tell it what you want to learn. It researches the topic, gives you a short placement
check, builds a syllabus for your approval, then emails you a lesson at a time — each
with a quiz that decides what comes next. Your level climbs as you pass, all the way to
mastery, in whatever language you choose.

mySensei runs on Cloudflare (Worker + D1) and GitHub Actions, with Claude doing the
research, placement, level-judging, and lesson writing.

---

## The learning loop

1. **Get an invite.** The owner adds your email to an allowlist. You sign in with a
   magic link — no password.
2. **Start a course.** From your dashboard, name a subject and a few preferences
   (language, lesson length, cadence, delivery time). Your account email is the
   recipient; you don't type it again.
3. **Placement check.** mySensei researches the subject and sends you a 7-question
   check whose questions climb from easy to hard, so it can place you on a 1–10 scale
   instead of asking you to guess your own level.
4. **Syllabus.** Claude judges your level from the answers and drafts a module outline
   whose target levels climb toward 10. You review and approve it.
5. **Lessons.** Each lesson is a single, light HTML page — formatted text, a key-idea
   callout, real web links for media, and a short quiz at the end. The whole page,
   quiz included, is written in your language and renders right-to-left for Hebrew,
   Arabic, and the like.
6. **Quizzes drive progress.** You answer; the result flows back and decides the next
   step: **pass → advance and raise your level; fail → re-teach the module a different
   way.** Wrong answers feed targeted reinforcement into the next lesson.
7. **Mastery and beyond.** Below level 10, the course keeps generating more advanced
   modules. At level 10 it asks you to pick a **specialization** — a deeper or adjacent
   niche — and builds a fresh track from there.

---

## Architecture

Three roles, each doing what it is best at:

- **Cloudflare Worker + D1** — the front door and the store. The Worker handles
  passwordless auth, the dashboard API, all course pages, the form/quiz/approve
  callbacks, and an internal API the generators use. **D1 (serverless SQLite) is the
  single source of truth** for every course. The Worker serves each page directly from
  D1 at `/c/:id/<slug>`.
- **GitHub Actions** — the generator. Workers can't run the multi-minute Claude work,
  so each generation job runs as an Action scoped to one `courseId`: it fetches the
  course from the Worker, runs the pure logic and renderers, writes the result back,
  stores the rendered HTML, and emails the learner.
- **Claude (Anthropic API)** — research (with web search), placement-question writing,
  level judging, and lesson authoring, all via structured outputs.
- **Gmail** — delivery, through a small send-only Action.

### Request flow

```
Learner ──login──▶ Worker (magic link, allowlist) ──▶ Dashboard
   │
   └─ start course ─▶ /c/:id/onboard (form) ─▶ POST /submit
                                                   │ repository_dispatch {courseId}
                                                   ▼
                                          GitHub Actions (generator)
                                       fetch ▲           │ write
                                             │           ▼
                                   Worker /internal/course/:id  ◀──▶  D1
                                             │
                                             └─ store page ─▶ served at /c/:id/<slug>
                                             └─ email link ─▶ Gmail
```

Authentication is a signed JWT cookie (30-day, HttpOnly, Secure, SameSite=Lax); magic
tokens are single-use with a 15-minute TTL. The Worker↔Actions internal API is gated by
a shared bearer token. Course IDs are 12-character base36 and act as the capability for
page links.

---

## Multi-tenant

mySensei serves several invited learners, each with several courses:

- **Invite-only.** Only allowlisted emails can sign in or onboard; everyone else gets a
  friendly "ask the owner" with no email sent and no cost incurred.
- **Passwordless.** Magic-link login, then a "My courses" dashboard to start, pause,
  resume, and open courses.
- **Bounded.** A small cap (default 3) on active courses per learner keeps cost in
  check; the rest stay paused.

The owner carries the LLM cost; there is no billing or public signup.

---

## Repository layout

```
lib/                      pure, framework-free logic (node --test)
  progress.mjs            quiz → advance/re-teach state machine, mastery, level climb
  ladder.mjs              modules-per-level by chunk size; builds the target-level ladder
  schedule.mjs            timezone / cadence / workweek "is a lesson due now" gate
  render-lesson.mjs       lesson HTML + quiz (RTL-aware), embeds courseId callback
  render-assessment.mjs   placement-check page
  render-syllabus.mjs     syllabus + approve button
  render-onboard.mjs      the onboarding form
  claude.mjs              Anthropic client: research (web search), structured outputs

scripts/                  GitHub Actions generators (Node 20 ESM)
  onboard.mjs             research + write the placement check
  build-curriculum.mjs    judge level + build the module outline
  generate-lesson.mjs     author the next lesson (or a mastery page)
  record-quiz.mjs         apply a quiz result to progress
  send-syllabus.mjs       store + email the syllabus link
  send-email.mjs          email the latest lesson link
  lib/course-store.mjs    HTTP client to the Worker internal API (read/write a course)

worker/                   Cloudflare Worker (ESM) + D1
  src/worker.mjs          router: auth, dashboard API, /submit, page serving, /internal
  src/db.mjs              D1 data access + curriculum↔row mapping + page store
  src/auth.mjs            HMAC sessions + single-use magic tokens (Web Crypto)
  src/internal.mjs        the service-token internal course/page API
  src/pages.mjs           login + dashboard HTML
  src/dispatch.mjs        maps a /submit body to a repository_dispatch payload
  src/email.mjs           fires the magic-link send-mail Action
  src/cookies.mjs         cookie read + session cookie builder
  migrations/0001_init.sql   allowlist, learners, courses, magic_tokens, pages
  test/                   vitest + @cloudflare/vitest-pool-workers (against a test D1)

.github/workflows/        repository_dispatch-driven generation + send-mail
.claude/skills/mySensei/  the /mySensei owner skill (interactive course setup)
docs/                     curriculum schema + design specs and implementation plans
```

---

## Setup

You need four accounts and a handful of secrets. Gather these before starting; the
order matters because later steps reference earlier values.

**Accounts**
- A **GitHub** repo (the generators run as Actions here).
- A free **Cloudflare** account (Worker + D1).
- An **Anthropic** API key (Claude).
- A **Gmail** account with an **app password** (delivery).

**Secrets and variables**

| Where | Name | What |
|---|---|---|
| Worker secret | `SESSION_SECRET` | long random string for signing session cookies |
| Worker secret | `GITHUB_TOKEN` | fine-grained token, **Contents: write** on the repo (fires dispatches) |
| Worker secret | `INTERNAL_TOKEN` | shared bearer token for the Worker↔Actions internal API |
| GitHub secret | `ANTHROPIC_API_KEY` | Claude API key |
| GitHub secret | `GMAIL_APP_PASSWORD` | Gmail app password for the sender account |
| GitHub secret | `INTERNAL_TOKEN` | same value as the Worker secret above |
| GitHub variable | `APP_BASE_URL` | the deployed Worker origin (e.g. `https://…workers.dev`) |
| GitHub variable | `MAIL_FROM` | the sender Gmail address |
| GitHub variable | `MAIL_TO` | fallback recipient (per-course email comes from the account) |

**Order of operations**

```bash
# 1. Create the D1 database, paste the printed id into worker/wrangler.toml
cd worker && npx wrangler d1 create mysensei
npx wrangler d1 migrations apply mysensei --remote

# 2. Worker secrets (paste at the prompt — never on the command line)
npx wrangler secret put SESSION_SECRET
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put INTERNAL_TOKEN

# 3. Deploy the Worker; confirm the URL matches APP_BASE_URL
npx wrangler deploy

# 4. GitHub side
gh secret set ANTHROPIC_API_KEY
gh secret set GMAIL_APP_PASSWORD
gh secret set INTERNAL_TOKEN
gh variable set APP_BASE_URL --body "https://<your-worker>.workers.dev"
gh variable set MAIL_FROM --body "you@example.com"

# 5. Allowlist yourself, then open the Worker URL and sign in
npx wrangler d1 execute mysensei --remote \
  --command "INSERT INTO allowlist(email, added_at) VALUES('you@example.com', datetime('now'))"
```

The repository_dispatch workflows run from the **default branch**, so the workflow files
must be on `main` for the loop to fire.

---

## Development

```bash
# Worker + D1 tests (migrations auto-applied to a test database)
cd worker && npm test

# Pure libs and the generator HTTP client
node --test lib/ scripts/lib/
```

The pure logic (`lib/progress`, `lib/ladder`, `lib/schedule`, the renderers) has unit
tests and no Cloudflare or Node-runtime dependencies, so the same modules run in both
the Worker and the Actions. Worker and D1 behavior is tested with
`@cloudflare/vitest-pool-workers` against a real test database.

---

## Status and roadmap

**Live**
- Multi-tenant foundation: allowlist, magic-link auth, dashboard, course CRUD, the
  active-course cap.
- Core course loop on D1: onboard → placement → curriculum → syllabus approval →
  Lesson 1 → quiz, with every page served from the Worker.

**Next (Plan 2b)**
- An hourly Cloudflare Cron sweep so lessons after the first are delivered on each
  course's cadence automatically.
- Course archive/delete and post-onboarding settings edits from the dashboard.
- Cleanup of the legacy single-tenant workflows.

**Deferred**
- Audio lessons (listening instead of reading).
- Public signup and billing.

Design specs and the task-by-task implementation plans live in
`docs/superpowers/`.
