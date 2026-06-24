# Admin List Refinements — Design

Date: 2026-06-24
Status: Approved (brainstorming), pending implementation plan

## Problem

Three refinements to the owner `/admin` page:
1. The user list's per-row "remove" buttons are clunky. Replace them with
   right-aligned checkboxes and a single "Remove selected" button.
2. The course list should show how many lessons have been delivered per course.
3. ("Number of active courses" was already covered — the summary line shows
   "N active" — so no change there.)

## Decisions (settled during brainstorming)

- **"Lessons" = lessons delivered (sent)**, not opened/viewed (the app has no
  view tracking). The count comes from `progress.delivered.length`, which is
  already maintained. It counts every lesson email sent, including re-taught
  attempts.
- **Bulk remove reuses the existing endpoint client-side.** "Remove selected"
  loops over the checked emails calling the existing
  `POST /api/allowlist/remove` (one request each — fine for a small allowlist).
  No new backend route.
- **No new privacy surface.** `adminStats` already returns no email addresses;
  reading `progress` (which contains no email) to count lessons keeps that
  guarantee.

## Components

### 1. Data — `adminStats(env)` in `worker/src/db.mjs`

- Extend the SELECT to also read `progress`:
  `SELECT subject, status, created_at, progress FROM courses WHERE subject IS NOT NULL AND subject != '' ORDER BY created_at DESC`.
- For each row add `lessons` to the returned course object:
  parse `progress` (JSON, nullable), `lessons = Array.isArray(progress.delivered) ? progress.delivered.length : 0`.
- The returned course shape becomes `{ topic, status, startedAt, lessons }`.
  `series` and `summary` are unchanged. The result still contains no email.

### 2. Course list — `adminPage()` in `worker/src/pages.mjs`

- `render()`'s table gains a **Lessons** column: header
  `Topic / Status / Started / Lessons`; each row appends
  `<td>` + `esc(c.lessons)` (a number).

### 3. User list — `adminPage()` in `worker/src/pages.mjs`

- `loadInvite()` renders each allowlisted user as a row with the email on the
  left and a **right-aligned checkbox** on the right (`value` = the email), in
  place of the per-row "remove" button. Below the list, a single
  **"Remove selected"** button.
- A `removeSelected()` handler: collect the checked emails; if none, do nothing;
  otherwise `confirm("Remove N user(s)?")`; on confirm, `await` a
  `POST /api/allowlist/remove` for each checked email (the existing route,
  one body `{ email }` per call), then re-run `loadInvite()` to refresh.
- The invite box + `invite()` are unchanged. Wiring stays event-delegation on
  `#users` (the existing listener handles `#invbtn`; add a branch for the
  "Remove selected" button id); **no inline `onclick`**.
- The server already blocks removing `OWNER_EMAIL` (returns 400), so the owner's
  own row, even if checked, is a harmless no-op that leaves them on the list.
- CSS: a row layout that right-aligns the checkbox (e.g. the `.allow li` rule
  gains `display:flex; justify-content:space-between; align-items:center`).

## Data flow

1. `/admin` loads → `loadStats()` fetches `/api/admin/stats` → `render()` draws
   the chart, summary, and the course table now with a Lessons column.
2. `loadInvite()` fetches `/api/allowlist` → renders rows with checkboxes + the
   "Remove selected" button.
3. "Remove selected" → confirm → N× `POST /api/allowlist/remove` → `loadInvite()`.

## Error handling

- **No users checked:** "Remove selected" is a no-op (no confirm, no requests).
- **A remove call fails** (e.g. the owner's own email → 400): other removes still
  proceed; the refresh reflects the true state. No partial-failure UI beyond the
  refresh.
- **`progress` missing/malformed** on a course: `lessons` defaults to 0.

## Testing

- **`adminStats` (db.test):** a course seeded with a `progress` JSON whose
  `delivered` has N entries reports `lessons: N`; a course with no/empty
  `progress` reports `lessons: 0`; the output still contains no `@`.
- **`adminPage` (pages.test):** the rendered HTML contains the `Lessons` column
  header; the user list renders checkboxes (`type="checkbox"`) and a
  "Remove selected" control; no `onclick=`; the `removeSelected` handler calls
  `/api/allowlist/remove`.

## Out of scope / deferred

- Real "opened/viewed" tracking (would need a page-load ping; separate feature).
- A bulk-remove backend endpoint (the client loop suffices for a small allowlist).
- Per-user course counts in the user list (active-courses summary already
  exists; not requested).
