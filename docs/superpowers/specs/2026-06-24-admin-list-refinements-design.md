# Admin List Refinements — Design

Date: 2026-06-24
Status: Approved (brainstorming), pending implementation plan

## Problem

Two refinements to the `/admin` page:
1. The **course list** should show how many lessons the learner has actually
   opened — a real engagement number. Lesson opens are not tracked today.
2. The **user list** should drop the per-row "remove" buttons in favor of a
   right-aligned checkbox per user plus a single "Remove" button that removes
   all checked users at once.

## Decisions (settled during brainstorming)

- **"Opened" = lessons the learner actually opened in a browser**, captured by a
  **client-side beacon** the lesson page fires on load — not a server-side count
  of every fetch (email scanners prefetch lesson links and would inflate a
  fetch count; scanners don't run JS, so the beacon excludes them).
- **Distinct lessons**, not total opens: reopening the same lesson counts once
  (`(course_id, slug)` is unique).
- **No identity stored** with a view — only `course_id` + lesson `slug` + a
  timestamp. Consistent with the admin "no names" guarantee.
- **Bulk remove**: a checkbox per user (right-aligned), the **owner's own row
  has no checkbox** (can't remove yourself), and one "Remove" button (blue,
  disabled until something is checked) removes all checked users, then refreshes.

## Architecture

```
Lesson page loads in a browser
  → its inline script POSTs /c/:id/:slug/opened
  → worker records (course_id, slug) once (INSERT OR IGNORE) in lesson_views

/admin → GET /api/admin/stats → adminStats(env)
  → courses LEFT JOIN a per-course distinct view count → each course gains `opened`
  → admin course table shows: Topic · Status · Started · Opened

/admin user management
  → GET /api/allowlist → { emails, owner }
  → each non-owner row: email + right-aligned checkbox
  → one "Remove" button → for each checked email, POST /api/allowlist/remove → reload
```

## Components

### 1. Data — `worker/migrations/0006_lesson_views.sql` + `worker/src/db.mjs`

- **Migration:**
  ```sql
  CREATE TABLE lesson_views (
    course_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    PRIMARY KEY (course_id, slug)
  );
  ```
  The composite primary key makes a repeat open of the same lesson a no-op.
- **`recordLessonView(env, courseId, slug) => void`** — `INSERT OR IGNORE INTO
  lesson_views(course_id, slug, opened_at) VALUES(?,?,?)` with `now()`.
- **`adminStats(env)`** — change the query to LEFT JOIN the per-course distinct
  count:
  ```sql
  SELECT c.subject, c.status, c.created_at, COUNT(v.slug) AS opened
  FROM courses c
  LEFT JOIN lesson_views v ON v.course_id = c.id
  WHERE c.subject IS NOT NULL AND c.subject != ''
  GROUP BY c.id
  ORDER BY c.created_at DESC
  ```
  Each `courses[]` object gains `opened` (a number; 0 when none). `series` and
  `summary` are computed from the same rows as today. `owner_email` is still
  never selected — `c.id` is used only for the JOIN/GROUP BY, not returned.

### 2. Beacon route — `worker/src/worker.mjs`

- **`POST /c/:id/:slug/opened`** — matched by
  `/^\/c\/([a-z0-9]+)\/(.+)\/opened$/` placed **before** the generic
  `/c/:id/:slug` GET route. Calls `recordLessonView(env, id, slug)` and returns
  `204`. No auth (lesson pages are public by link); no body. A bad/duplicate
  slug is harmless (INSERT OR IGNORE).
- **`GET /api/allowlist`** — extend the existing owner-gated response from
  `{ emails }` to `{ emails, owner: env.OWNER_EMAIL }` so the admin UI can omit
  the owner's checkbox.

### 3. Beacon emitter — `lib/render-lesson.mjs`

In the lesson page's existing inline IIFE (which already runs on load), fire a
fire-and-forget beacon near the top:

```javascript
try { fetch(location.pathname + "/opened", { method: "POST", keepalive: true }); } catch (e) {}
```

The page is served at `/c/:id/:slug`, so `location.pathname + "/opened"` is the
beacon URL. Only real lesson pages (rendered by `render-lesson.mjs`) carry this
script — syllabus/onboard/assessment pages use other renderers and never fire
it, so only lessons are counted. `keepalive` lets it complete if the page
navigates away quickly.

### 4. Admin UI — `worker/src/pages.mjs` `adminPage()`

- **Course table:** add an **"Opened"** column. The header becomes
  `Topic · Status · Started · Opened`; each row appends `<td>${esc(c.opened)}</td>`
  (`c.opened` is a number from `adminStats`).
- **User list:** replace the current `<li>email <button data-rm=…>remove</button></li>`
  with, per email, `email` + a **right-aligned checkbox** (`<input type="checkbox"
  data-email="…">`), EXCEPT the row whose email equals the response's `owner`
  (rendered without a checkbox). Add a single **"Remove"** button (class `blue`),
  **disabled** until at least one box is checked, below the list. Its handler
  collects the checked `data-email` values and, for each, `POST
  /api/allowlist/remove`; when all complete, re-fetch the list. Wire via the
  existing `#users` event delegation (no inline `onclick`); a `change` listener
  toggles the Remove button's disabled state.

## Data flow

1. Learner opens a lesson → beacon POST → `lesson_views` gets `(course_id, slug)` once.
2. Owner views `/admin` → `adminStats` joins the counts → course table shows Opened.
3. Owner checks users + clicks Remove → per-email removes → list refreshes.

## Error handling

- **Beacon failure / offline:** swallowed (`try/catch`, fire-and-forget); never
  blocks the lesson page.
- **Duplicate open:** `INSERT OR IGNORE` → no-op, count unchanged.
- **Owner checkbox:** not rendered, so the owner can't be selected; the
  `/api/allowlist/remove` owner guard (existing 400) remains a backstop.
- **Bulk remove with nothing checked:** the Remove button is disabled, so no call.
- **Unauthenticated beacon spam:** an attacker could POST opens to inflate a
  course's count (the endpoint is public by design). Accepted for a single-owner
  tool — the number is a soft engagement signal, not a billing input.

## Testing

- **db:** `recordLessonView` inserts once and is idempotent on a repeat
  (course_id, slug); `adminStats` returns `opened` per course (0 with no views,
  N distinct with views) and still excludes empty-subject courses and leaks no
  email.
- **beacon route:** `POST /c/:id/:slug/opened` → 204 and a row recorded; a
  second identical POST keeps the count at 1; `GET` on that path still serves the
  page (route precedence intact).
- **allowlist response:** `GET /api/allowlist` includes `owner`.
- **render-lesson:** the lesson HTML contains the beacon (`/opened` POST on load);
  syllabus/onboard renderers do not.
- **adminPage:** course table has an "Opened" header + cell; the user list
  renders checkboxes (not per-row remove buttons), omits the owner's checkbox,
  and has a single disabled-until-checked "Remove" button; no `onclick=`.

## Out of scope / deferred

- Per-lesson open timestamps / a views-over-time chart (the table just shows a
  count).
- Total opens vs distinct (we count distinct lessons).
- De-duplicating scanner traffic beyond the JS-beacon approach (good enough).
- Showing which specific lessons were opened.
