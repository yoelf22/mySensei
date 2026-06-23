# Admin course dashboard — design

**Date:** 2026-06-23
**Status:** Approved (design)

## Goal

Give the owner a single page that shows, across all users and without
revealing any names, how the product is being used: how many courses have
been started over time, and the current state of each one.

## Scope

In scope:
- An owner-only web page at `/admin`.
- A line graph of **total courses started**, cumulative, day by day.
- A one-line status summary.
- A combined table: one row per course — topic, status, start date.
- **User management, relocated here from the dashboard:** the allowlist user
  list (with remove buttons) and the original owner invite box (adds an email
  straight to the allowlist, no quota). See "User management relocation".

Out of scope (not building):
- Per-user / per-name breakdowns. Names are never shown or sent.
- Day-by-day history of *status* (e.g. "active each day"). The database does
  not retain status history, and the chosen graph metric does not need it.
- Any scheduled/daily job. The page is computed live on each load.

## What counts as a "started" course

A course row is created (`status = 'draft'`) the moment a user clicks "new
course", before they have said what they want to learn. These bare drafts —
rows with **no `subject`** — are abandoned clicks, not started courses.

Decision: **exclude rows with an empty `subject`** from both the graph and the
table. Every course from `awaiting-assessment` onward (which is where a subject
first exists) is counted. The lifecycle is:

```
draft → awaiting-assessment → active → paused (optional) → done
```

This is the one tunable assumption; it lives in a single WHERE clause and can
be changed later.

## Architecture

Three pieces, matching existing patterns in the worker.

### 1. Data — `adminStats(env)` in `worker/src/db.mjs`

A single function that returns everything the page needs, already aggregated,
with **no email addresses in the result**:

```js
adminStats(env) -> {
  courses: [ { topic, status, startedAt } ],   // newest first, subject != ''
  series:  [ { date: 'YYYY-MM-DD', total } ],  // cumulative count by day
  summary: { started, active, paused, done }   // status tallies
}
```

- `courses` comes from `SELECT subject, status, created_at FROM courses
  WHERE subject IS NOT NULL AND subject != '' ORDER BY created_at DESC`.
- `series` is derived from the same rows: group by calendar day of
  `created_at`, then a running cumulative sum. Days with zero new courses are
  not emitted; the chart connects the points it has.
- `summary` is tallied from the same rows.

`owner_email` is selected by nothing here, so it cannot reach the client.

### 2. Data feed — `GET /api/admin/stats` in `worker/src/worker.mjs`

- Requires a valid session **and** `isOwner(email, env)`.
- Non-owner (or signed-out) → `403` / `401`, same as `/api/allowlist`.
- On success returns the `adminStats(env)` object as JSON.

### 3. Page — `GET /admin` + `adminPage()` in `worker/src/pages.mjs`

- `GET /admin`: server-side, confirm session + owner. If not the owner,
  `302` redirect to `/`. If owner, return the HTML.
- `adminPage()` returns a self-contained HTML string (same style as
  `dashboardPage()` / `loginPage()` — no front-end framework, no external
  scripts). On load it fetches `/api/admin/stats` and renders:
  1. The line graph as a **hand-built inline SVG** (no chart library). X axis =
     date, Y axis = cumulative total. A polyline through the `series` points
     with a few axis labels.
  2. The summary line: `"{started} started · {active} active · {paused}
     paused · {done} done"`.
  3. The table: topic / status / start date, newest first.
- Empty state: if there are no started courses yet, show a friendly "No
  courses started yet" message instead of an empty chart and table.
  4. **User management** (below the course stats): the allowlist user list with
     remove buttons, plus the original owner invite box. This reuses the
     existing owner-only endpoints unchanged — `GET /api/allowlist`,
     `POST /api/invite`, `POST /api/allowlist/remove` — and is the same UI the
     dashboard's `loadInvite()` renders today, moved here verbatim.

## User management relocation

The dashboard (`worker/src/pages.mjs`, `dashboardPage()`) currently shows two
different invite UIs depending on who is signed in:

- **Owner** → `loadInvite()`: the original invite box (direct-to-allowlist) and
  the allowlist user list with remove buttons.
- **Non-owner** → `renderInvitePanel(remaining)`: the quota box ("N of 5
  invites left").

Changes:

- **Move** the owner's `loadInvite()` UI (invite box + user list) to the
  `/admin` page.
- **On the dashboard, the owner no longer sees an invite box.** Instead the
  dashboard shows a small **"Admin" link** (owner-only) at the top, pointing to
  `/admin`. Non-owners do not see this link.
- **Leave** the non-owner quota box (`renderInvitePanel`) on the dashboard
  exactly as-is.
- No API or endpoint changes — only where the existing UI is rendered. The
  owner-only guards on `/api/allowlist*` already enforce access.

## Data flow

```
browser GET /admin
  → worker checks session + owner → serves adminPage() HTML
  → page JS calls GET /api/admin/stats
  → worker checks session + owner → adminStats(env) → JSON (no emails)
  → page renders SVG line + summary + table
```

## "Updates every day"

Satisfied implicitly: every load recomputes from the live database, so the
numbers are always current. No cron, no snapshot table, nothing to maintain.

## Error handling

- API: unauthorized → 401; authorized-but-not-owner → 403; DB failure bubbles
  as a 500 (worker default). The page shows a short "Couldn't load stats"
  message if the fetch fails.
- Page route: not-owner → redirect to `/` (no information leak about the
  page's existence beyond the redirect).

## Testing (worker/test, following existing patterns)

- **db:** `adminStats` returns cumulative `series` that matches a known set of
  seeded `created_at` dates; excludes empty-subject drafts; tallies `summary`
  correctly.
- **route/auth:** owner gets `200` + data from `/api/admin/stats`; a non-owner
  signed-in user gets `403`; signed-out gets `401`.
- **privacy:** the `/api/admin/stats` response body contains no `@` /
  email-shaped string.
- **page:** `GET /admin` as owner returns HTML; as non-owner returns a `302`
  to `/`.
- **relocation:** the dashboard no longer renders the owner invite/allowlist UI
  (owner sees an "Admin" link instead); the non-owner quota box is unchanged.

## Files touched

- `worker/src/db.mjs` — add `adminStats`.
- `worker/src/worker.mjs` — add `/api/admin/stats` and `/admin` routes.
- `worker/src/pages.mjs` — add `adminPage()` (course stats + relocated user
  management); remove the owner branch of `dashboardPage()` and add the
  owner-only "Admin" link.
- `worker/test/*` — new assertions per above.

No new dependencies. No new tables. No migration.
