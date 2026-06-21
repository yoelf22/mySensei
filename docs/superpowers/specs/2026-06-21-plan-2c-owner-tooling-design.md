# mySensei Plan 2c — Owner Tooling Design

- **Date:** 2026-06-21
- **Status:** Approved (brainstorming) — ready for implementation planning
- **Author:** Yoel + Claude

## Context

The platform runs end to end (multi-tenant auth, dashboard, onboarding → placement →
curriculum → syllabus → lessons → quizzes → hourly cron delivery, plus a per-course
contents page). But two owner-facing gaps remain: adding learners still means a CLI
`d1 execute` + a manual dispatch, and when a generation job fails the owner only learns
about it by reading GitHub Action logs. Plan 2c gives the owner browser tooling for both,
plus two small robustness fixes flagged in the 2b review.

## Goal

Let the owner invite and manage learners from the dashboard, and surface generation/send
failures both on the dashboard and by email — without touching the CLI or Action logs.

## Decisions (settled in brainstorming)

| Decision | Choice |
|---|---|
| Who can invite / manage the allowlist | A single **owner** (`OWNER_EMAIL`); only they see the Invite box |
| Failure notification | **Both**: a dashboard "⚠ delayed" badge (durable, auto-clears) **and** an email to the owner |
| Scope | Invite box + failure visibility + the two 2b robustness items |

## Out of scope (later)

Course archive/delete and post-onboarding settings edits; specialization-on-web; audio;
public signup/billing; a global daily-generation cost ceiling.

## Components

### 1. Owner identity
- New config `OWNER_EMAIL` = `yoel.frischoff@gmail.com`, set as a Worker **variable**
  (`wrangler.toml [vars]`) and a GitHub Actions **variable** (used by the failure email).
- `isOwner(email, env)` helper: `!!email && email.toLowerCase() === String(env.OWNER_EMAIL || "").toLowerCase()`.
- Owner-only Worker routes verify the session email is the owner; non-owner → `403`.

### 2. Invite box (dashboard, owner-only)
- `GET /api/courses` response gains an `isOwner` boolean; the dashboard reveals the Invite
  panel only when true.
- Worker routes (cookie auth + owner check):
  - `POST /api/invite {email}` → validate + lowercase, `addToAllowlist`, `sendInvite`; returns `{ ok: true }`.
  - `GET /api/allowlist` → `{ emails: [...] }`.
  - `POST /api/allowlist/remove {email}` → `removeFromAllowlist`; refuses to remove `OWNER_EMAIL`.
- `db.mjs`: `addToAllowlist(env, email)` (INSERT OR IGNORE, lowercased, `added_at`),
  `listAllowlist(env)` (emails, ordered), `removeFromAllowlist(env, email)`.
- `email.mjs`: `sendInvite(env, email)` — fires the existing `send-mail` Action with the
  invite copy and the login URL (`${APP_BASE_URL}/`).
- Dashboard: an Invite panel (email field + Invite button) and the current allowlist with
  per-row Remove buttons, wired by event delegation (no inline handlers).

### 3. Failure visibility (badge + email)
- `db.mjs`: `setLastError(env, id, msg)` (UPDATE `last_error`); `saveCurriculum` clears it
  on every successful save (`last_error = NULL`).
- Worker internal route: `PUT /internal/course/:id/error {error}` (bearer auth) → `setLastError`.
- `scripts/lib/course-store.mjs`: `reportError(courseId, msg)` → that endpoint.
- New `scripts/report-failure.mjs`: reads `COURSE_ID` + the Action run context, calls
  `reportError(COURSE_ID, …)` and emails `OWNER_EMAIL` (via nodemailer) a short alert with
  the course id and the run URL (`${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`).
- Each generation workflow (`onboard.yml`, `build-curriculum.yml`, `deliver-lesson.yml`,
  `record-quiz.yml`) gets a final `if: failure()` step running `report-failure.mjs`, with
  env `COURSE_ID`, `APP_BASE_URL`, `INTERNAL_TOKEN`, `OWNER_EMAIL`, `MAIL_FROM`,
  `GMAIL_APP_PASSWORD`.
- Dashboard: each course card shows a "⚠ delayed" badge when `last_error` is set
  (`/api/courses` already returns the column).

### 4. Robustness (from the 2b review)
- `sweep.mjs` `runSweep`: after `Promise.allSettled`, `console.error` any rejected
  dispatches (course id + reason) instead of swallowing them.
- `deliver-lesson.yml`: add `concurrency: { group: deliver-${{ github.event.client_payload.courseId }} }`.

## Data flow

Invite: owner types an email → `POST /api/invite` (owner-gated) → `addToAllowlist` +
`sendInvite` (send-mail Action) → the learner gets the invite and signs in. Failure: a
generation Action throws → its `if: failure()` step runs `report-failure.mjs` →
`last_error` set on the course (dashboard badge) + an email to the owner → the next
successful generation clears `last_error`.

## Error handling

- Non-owner hitting an owner route → `403` (no allowlist change, no email).
- `POST /api/invite` with a malformed email → `400`; re-inviting an existing address is
  idempotent (INSERT OR IGNORE) and re-sends the invite.
- `removeFromAllowlist` refuses the owner's own address.
- `report-failure.mjs` is best-effort: if reporting/emailing itself fails it logs and
  exits 0 so it never masks the original failure or fails the run twice.

## Testing

- `isOwner` truth table; owner-gating returns `403` for a non-owner on `/api/invite`,
  `/api/allowlist`, `/api/allowlist/remove`.
- `addToAllowlist` / `listAllowlist` / `removeFromAllowlist` round-trip; remove refuses the owner.
- `POST /api/invite` adds the email and fires the invite dispatch (mock fetch).
- `setLastError` sets the column; `saveCurriculum` clears it on the next save.
- `/api/courses` returns `isOwner`; cards render the badge when `last_error` is set.
- `report-failure.mjs` via `node --test` (mock fetch + nodemailer): calls `reportError`
  and sends to `OWNER_EMAIL`; never throws.
- Dashboard structural test: Invite panel logic gated on `isOwner`; delegation, no inline
  handlers; the dashboard `<script>` parses.

## Reused vs new

- **Reused:** the send-mail Action + `email-link`/nodemailer pattern; the `/internal` API;
  the `last_error` column (already in the schema); the dashboard + `/api/courses`.
- **New:** `OWNER_EMAIL` + `isOwner`; the invite/allowlist routes + db helpers + `sendInvite`;
  `setLastError` + the `/internal/.../error` route + `reportError` + `report-failure.mjs` +
  the per-workflow failure steps; the dashboard Invite panel + badge; the two robustness fixes.
