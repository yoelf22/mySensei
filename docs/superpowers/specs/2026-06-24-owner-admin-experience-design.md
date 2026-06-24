# Owner Admin Experience — Design

Date: 2026-06-24
Status: Approved (brainstorming), pending implementation plan

## Problem

The owner's `/dashboard` mixes two unrelated things: the owner's own personal
courses and the list of users they've invited. The owner wants a real **admin
dashboard** (usage stats, a cross-user course list, the user list, and invites),
reached by a **username + password** login rather than the learner magic-link
flow. The course-card buttons also need clearer, safer styling.

Much of the admin dashboard is already built (and tested) on the unmerged
`plan-4-admin-dashboard` branch; this work re-applies that onto the current
`main` (which now has invites + sharing) and adds the new auth + button pieces.

## Decisions (settled during brainstorming)

- **The owner signs in with username + password only.** A `/admin/login` page
  verifies credentials and mints the existing owner session; the owner's email
  is **refused on the magic-link path** (can't be phished in). Learners keep the
  magic-link flow unchanged.
- **Credentials live in Worker secrets** (`ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH`,
  a SHA-256 hex of the password), compared with a constant-time check. No D1
  changes; nothing sensitive stored in the database. (Chosen over a D1 `admins`
  table — YAGNI for one owner — and over HTTP Basic Auth — no real logout.)
- **`/admin` is the owner's home.** A correct login lands there. It carries the
  started-courses chart, status summary, all-courses table, the user/allowlist
  list + remove, and the owner invite box — adopted from the admin branch.
- **`/dashboard` is de-mixed.** Owner: just their course cards (Open /
  Pause·Resume / Share) + an "Admin" link, no invite/user panel. Non-owner
  learner: their course cards + the existing "N of 5 invites left" quota panel.
- **Button UX:** Pause is **red** and asks for confirmation before acting (it
  stops lessons); Resume stays a normal button (the toggle already exists);
  Invite buttons are **blue**; Share is visually separated from Pause on the
  card. The Pause confirmation is a simple `confirm()` dialog (a genuine
  double-check, no inline-script escaping risk).

## Architecture

```
Owner:
  GET /admin/login        → username + password form
  POST /admin/login       → verify (ADMIN_USERNAME + sha256(pw)==ADMIN_PASSWORD_HASH,
                             constant-time) → mint owner session (signSession(OWNER_EMAIL))
                             → 302 /admin ; on failure → generic "wrong credentials"
  GET /admin              → owner-session-gated: adminPage() (chart/summary/courses/users/invite)
  GET /api/admin/stats    → owner-gated: adminStats(env)
  /dashboard              → owner's personal courses (+ "Admin" link)
  /  with owner email     → magic link REFUSED (owner must use /admin/login)

Learner (invited user):
  /  (email) → magic link → /dashboard (course cards + quota invite panel)
```

The password login is just an alternate way to obtain the **owner session** the
app already understands; every existing `isOwner(sessionEmail, env)` gate
(`/admin`, `/api/admin/*`, `/api/allowlist`, owner `/api/invite`) is unchanged.

## Components

### 1. Admin auth — `worker/src/worker.mjs` (+ a small helper)

- **`GET /admin/login`** → `adminLoginPage()` (a username + password form posting
  to `/admin/login`).
- **`POST /admin/login`** → read `{ username, password }`; verify
  `username === env.ADMIN_USERNAME` AND `sha256hex(password) === env.ADMIN_PASSWORD_HASH`
  using a **constant-time** comparison (a length-checked char-xor accumulator,
  not `===` on the secret). On success: `Set-Cookie` the owner session
  (`signSession(env.OWNER_EMAIL, env.SESSION_SECRET)`) and 302 to `/admin`. On
  failure: re-render the login page with a generic "Wrong username or password"
  (no distinction between bad user vs bad password). Always 200/302 — no timing
  or message oracle beyond the constant-time compare.
- **`POST /auth/request`** gains an owner guard: if the submitted email equals
  `env.OWNER_EMAIL` (case-insensitive), do nothing (no magic link), still return
  `{ ok: true }`. (Keeps the no-enumeration contract.)
- A tiny pure helper `sha256Hex(str)` (WebCrypto `crypto.subtle.digest`) and
  `timingSafeEqual(a, b)` live in `worker/src/auth.mjs` (tested there).

### 2. The `/admin` panel — re-applied from `plan-4-admin-dashboard`

Port these onto current `main` (the logic is already written + tested on that
branch; adapt to the current files):
- **`adminStats(env)`** in `db.mjs` → `{ courses:[{topic,status,startedAt}], series:[{date,total}], summary:{started,active,paused,done} }` — courses with a non-empty `subject`, cumulative by-day series, status tallies; **no email addresses** in the result.
- **`GET /api/admin/stats`** — owner-gated JSON feed of `adminStats`.
- **`GET /admin`** — owner-gated; serves `adminPage()`.
- **`adminPage()`** in `pages.mjs` — fetches `/api/admin/stats` and renders: a
  hand-built inline-SVG line chart of cumulative started courses; the summary
  line; the all-courses table (topic / status / start date); and the **user
  management** block (allowlist list + remove via `/api/allowlist`,
  `/api/allowlist/remove`, and the owner invite box via `/api/invite`). The
  invite button here is **blue** (see §4).

### 3. De-mixed `/dashboard` — `pages.mjs` `dashboardPage()`

Reconcile the current `main` dashboard (which has the Share button + the
non-owner quota invite panel from the sharing/invites features) with the admin
split:
- Add an **"Admin"** link (shown only when `isOwner`, via the existing
  `/api/courses` `isOwner` flag) that navigates to `/admin`.
- **Owner:** do **not** render an invite/allowlist panel here (it now lives on
  `/admin`). Keep their course cards.
- **Non-owner:** keep the existing `renderInvitePanel(remaining)` ("N of 5
  invites left") exactly as today.
- All course cards keep Open / Pause·Resume / **Share** (from the sharing
  feature).

### 4. Button UX — `pages.mjs`

- **Pause** (course card, `data-act="pause"`): styled **red** (a `.danger` class
  — red background). Its delegation handler shows a `confirm("Pause this course?
  Lessons stop until you resume.")`; only on confirm does it call the pause
  endpoint. **Resume** (`data-act="resume"`) stays the normal accent button and
  needs no confirm; the pause→resume toggle already exists in `dashboardPage`.
- **Invite** buttons (`#invbtn` on `/admin` and on the non-owner `/dashboard`
  panel): styled **blue** (a `.blue` class).
- **Share** (`data-share`): keep its current accent styling but give it spacing
  so it reads as separate from the red Pause (e.g. a separator / its own group
  in the card's button row).
- No inline `onclick` (the existing delegation pattern + the regression test
  that asserts `not.toContain("onclick=")` are preserved).

### 5. Setup & secrets

New, owner-set before deploy:
- `ADMIN_USERNAME` (Worker var) — the admin login name.
- `ADMIN_PASSWORD_HASH` (Worker **secret**) — `printf '%s' '<password>' | shasum -a 256`
  (hex). The plan/setup notes include the exact command.
No new D1 migration.

## Data flow

1. Owner opens `/admin/login`, submits credentials → owner session → `/admin`.
2. `/admin` fetches `/api/admin/stats` → renders chart/summary/courses + user mgmt.
3. Owner clicks "My courses"/dashboard link → `/dashboard` (their courses only).
4. A learner still: `/` → magic link → `/dashboard` (+ quota invite panel).

## Error handling

- **Bad admin credentials:** generic "Wrong username or password", constant-time
  compare, no user-vs-password distinction, no enumeration.
- **Owner email on the magic-link form:** silently no-ops (still `{ ok: true }`).
- **Unauthenticated `/admin` or `/api/admin/*`:** existing owner gate → 401/redirect
  to `/admin/login` (page route redirects; API returns 403/401 as today).
- **Missing `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`:** the login can never succeed
  (no credential to match) — fail closed.

## Testing

- **auth helpers:** `sha256Hex` known-vector; `timingSafeEqual` true/false +
  length-mismatch.
- **admin login route:** correct creds → 302 `/admin` + owner session cookie;
  wrong password / wrong username / missing secret → re-render with the generic
  error, no cookie; the issued cookie verifies as `OWNER_EMAIL`.
- **owner magic-link refusal:** `/auth/request` with `OWNER_EMAIL` sends no link
  (mock `fetch` not called), returns `{ ok: true }`; a normal allowlisted email
  still works.
- **`/admin` gating:** owner session → 200 + adminPage; no session → redirect to
  `/admin/login`; `/api/admin/stats` owner-only (403 for a non-owner).
- **`adminStats`:** cumulative series from seeded dates; excludes empty-subject
  drafts; status tallies; no `@`/email string in the output.
- **dashboard de-mix:** owner dashboard HTML has the Admin link and NO allowlist
  panel; non-owner has the quota panel and no Admin link; both keep Share.
- **buttons:** pause button carries the `danger`/red class and a confirm in the
  handler; invite carries the blue class; resume present for paused; no
  `onclick=`.

## Out of scope / deferred

- Per-user / per-name analytics (the "no names" guarantee from the admin branch
  is kept — `owner_email` is never selected/sent).
- In-app admin password change / multiple admins (single owner, secret-based).
- Login rate-limiting / lockout (constant-time compare only for v1; revisit if
  abuse appears).
- Status-history charts (the DB doesn't retain status history).
