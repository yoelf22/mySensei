# Admin User Stats — Design

Date: 2026-06-25
Status: Approved (brainstorming), pending implementation plan

## Problem

The owner's `/admin` user list shows just email addresses. The owner wants, per
user, **how many courses they started** and **how many lessons they finished**.

## Decisions (settled during brainstorming)

- **"Courses started"** = the user's courses that have a topic — same rule as the
  admin chart: `subject` non-empty (`owner_email = email`). Bare drafts (no
  subject) don't count.
- **"Lessons finished"** = lessons the learner **passed** (the course advanced
  past that module), computed as `max(0, progress.currentModule - 1)` summed
  across their courses. (Each quiz pass increments `currentModule`; a not-yet-
  started course at `currentModule = 1` contributes 0.) This is distinct from the
  course list's "Lessons" (delivered/sent) column.
- **Per-user stats live only in the owner-only user list.** The chart feed
  (`/api/admin/stats`) stays email-free as before; the new per-user data is on a
  separate owner-gated endpoint, and the user list already shows emails — so no
  new exposure.

## Components

### 1. Data — `listUsers(env)` in `worker/src/db.mjs`

Returns the allowlist enriched per user:

```js
listUsers(env) -> [ { email, courses, lessons } ]   // one per allowlisted email
```

- `emails = await listAllowlist(env)` (normalized).
- One pass over courses: `SELECT owner_email, subject, progress FROM courses`.
  For each row with a non-empty `subject`, key by `norm(owner_email)`:
  `courses += 1`; `lessons += max(0, (parsed progress.currentModule || 1) - 1)`
  (parse `progress` JSON; on null/malformed, treat `currentModule` as 1 → adds 0).
- Map onto every allowlisted email, defaulting to `{ courses: 0, lessons: 0 }`
  for users with no courses. Order follows `listAllowlist`.
- Selects no data beyond `owner_email` (used only as an aggregation key, not
  returned beyond the already-listed allowlist emails).

### 2. Endpoint — `GET /api/admin/users` in `worker/src/worker.mjs`

- Owner-gated, mirroring `/api/admin/stats`: no session → 401; non-owner → 403;
  owner GET → `json({ users: await listUsers(env) })`; other method → 405.

### 3. User list — `adminPage()` in `worker/src/pages.mjs`

- `loadInvite()` fetches **`/api/admin/users`** (instead of `/api/allowlist`) and
  renders each row as the email plus a muted **"N courses · M finished"**, with
  the right-aligned checkbox (value = email) and the "Remove selected" button
  unchanged. Remove still posts to `/api/allowlist/remove`.
- Empty list → the "Users" heading with no rows (as today).
- `esc()` on the email; counts are numbers.

## Data flow

1. `/admin` loads → `loadInvite()` → `GET /api/admin/users` → `listUsers` joins
   the allowlist with per-owner course aggregates.
2. Each row renders email + "N courses · M finished" + checkbox.
3. Remove selected → `POST /api/allowlist/remove` per checked email → re-fetch.

## Error handling

- **User with no courses:** `{ courses: 0, lessons: 0 }`.
- **Course with null/malformed `progress`:** contributes 0 lessons (and counts as
  a started course only if it has a subject).
- **Non-owner / anon hitting `/api/admin/users`:** 403 / 401.

## Testing

- **`listUsers` (db):** an allowlisted user with 2 subject-bearing courses whose
  `progress.currentModule` is 3 and 1 reports `courses: 2, lessons: 2` (2 passed
  + 0 passed); a bare-draft course (no subject) is excluded; an allowlisted user
  with no courses → `{ courses: 0, lessons: 0 }`; the result contains only
  allowlisted emails.
- **route:** `GET /api/admin/users` owner → 200 `{ users }`; non-owner → 403;
  anon → 401.
- **`adminPage`:** the user list fetches `/api/admin/users` and the row template
  renders the per-user "courses" + "finished" counts; checkbox + Remove selected
  preserved; no inline `onclick`.

## Out of scope / deferred

- Lessons delivered (sent) per user — already available as the course list's
  "Lessons" column; not duplicated here.
- Per-course breakdown within a user row (just the two totals for v1).
- Sorting/filtering the user list by these counts.
