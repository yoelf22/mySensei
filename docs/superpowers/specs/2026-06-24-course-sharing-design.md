# Course Sharing — Design

Date: 2026-06-24
Status: Approved (brainstorming), pending implementation plan

## Problem

A learner taking a course has no way to hand it to someone else. We want a
shareable link that drops a new person into onboarding with the **topic and
angle pre-filled**, so they start their own fresh copy of the course (their own
placement, level, settings) without retyping the subject.

## Decisions (settled during brainstorming)

- **Anyone with the link can accept.** The link itself grants access — a new
  person signs in and is auto-allowlisted; no prior invite needed. Sharing *is*
  the invite, and it does **not** consume the sharer's 5-invite quota.
- **What carries over: subject + angle only.** Snapshotted at share time. The
  recipient chooses their own language, education level, lesson length, cadence,
  and does their own placement check.
- **Each link is capped at `max_uses = 10` acceptances.** After 10, the link is
  "full" and stops auto-allowing — bounds runaway onboardings (each acceptance
  triggers an API-expensive research + placement, and the account is rate-limited).
- **A use is consumed — and an email allowlisted — only on a verified sign-in.**
  Not on link-open and not on the email-request step. So nobody can burn a link
  or allowlist a stranger just by submitting an address; only the real inbox
  owner who clicks the magic link completes it.
- **The recipient becomes a normal user.** After accepting they own their new
  course and get their own 5 invites — same as any allowlisted user.

## Architecture

```
Sharer (signed in, owns course)
  POST /api/courses/:id/share
    → snapshot {subject, angle}; create shares row (max_uses 10, uses 0)
    → returns { url: APP_BASE_URL/share/<token> }

Recipient: GET /share/:token
  token invalid OR uses >= max_uses → "link no longer available" page
  already signed in → claimShareUse + create preset draft course → /c/:id/onboard
  not signed in → landing page ("learn {subject} — enter your email")
     POST /auth/request { email, shareToken }
       valid + non-full token authorizes the magic link even if email not allowlisted
       → mintToken bound to share_token, sendMagicLink
     GET/POST /auth/verify  (consume magic token → {email, shareToken})
       shareToken present:
         claimShareUse(token)  // atomic uses++ ; if it just filled → "link full"
         allowlist email (invited_by = 'share')
         create preset draft course (owner = email, subject+angle set)
         set session cookie → 302 /c/:id/onboard
       no shareToken: normal → /dashboard
  → onboarding form prefilled (subject, angle); recipient picks the rest
  → their own placement → their own curriculum
```

## Components

### 1. Data — `worker/migrations/0005_shares.sql` + `worker/src/db.mjs`

- **Migration:**
  - `CREATE TABLE shares ( token TEXT PRIMARY KEY, subject TEXT NOT NULL, angle TEXT, max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at TEXT NOT NULL );`
  - `ALTER TABLE magic_tokens ADD COLUMN share_token TEXT;` (carries share intent through the email round-trip; NULL for normal sign-ins.)
- **db functions:**
  - `createShare(env, { subject, angle, createdBy, maxUses = 10 }) => { token }` — `token = randomId(24)`.
  - `getShare(env, token) => row | null`.
  - `claimShareUse(env, token) => boolean` — atomic: `UPDATE shares SET uses = uses + 1 WHERE token = ? AND uses < max_uses`; returns `true` iff `meta.changes === 1` (a slot was claimed). A full or unknown token returns `false`.
  - `createCourseWithSubject(env, ownerEmail, subject, angle) => { id }` — like `createCourse` but sets `subject` + `angle` on the new draft row (status stays `draft`; the recipient still runs onboarding to set settings + placement). Reuse/extend `createCourse` rather than duplicate.

### 2. Auth carry-through — `worker/src/auth.mjs`

- `mintToken(env, email, shareToken = null)` — store `share_token` alongside the magic token (additive, optional param; existing callers unaffected).
- `consumeToken(env, token) => { email, shareToken } | null` — return the bound `share_token` (or null) with the email, keeping the existing atomic single-use `UPDATE ... WHERE used = 0` guard. (Return shape changes from a bare string to an object; update the one caller in `worker.mjs`.)

### 3. Routes — `worker/src/worker.mjs`

- **`POST /api/courses/:id/share`** — session required; the course must exist and be owned by the session email (mirror the pause/resume ownership check); `createShare` from the course's `subject`/`angle`; return `{ url }`. A course with no subject yet (bare draft) → 400 "nothing to share yet".
- **`GET /share/:token`** — `getShare`; invalid or `uses >= max_uses` → the "no longer available" HTML page. If a session exists: `claimShareUse`; on success create the preset course and 302 to `/c/:id/onboard`; on failure (just filled) → "full" page. If no session: render the share landing page (shows `subject`, an email box, the token).
- **`POST /auth/request`** — accept an optional `shareToken`. Current behavior: send a magic link only if `isAllowlisted`. New: if a **valid, non-full** `shareToken` is present, mint a magic token bound to it and send the link **even when the email is not allowlisted**; otherwise keep the existing allowlisted-only behavior. Always returns `{ ok: true }` (no user enumeration).
- **`/auth/verify` (POST consume)** — `consumeToken` now yields `{ email, shareToken }`. If `shareToken` is set: `claimShareUse(shareToken)` → if false, show "this link is full"; else allowlist the email (`addToAllowlist(env, email, 'share')`), `createCourseWithSubject`, set the session cookie, 302 to `/c/:id/onboard`. If no `shareToken`: existing redirect to `/dashboard`.

### 4. Onboarding prefill — `lib/render-onboard.mjs`

- `renderOnboardHtml({ webhookUrl, courseId, subject = "", angle = "" })` — render the subject `<textarea>` and angle `<input>` with the prefilled values (HTML-escaped), and seed the JS payload defaults from them. The worker's `/c/:id/onboard` route passes the course's stored `subject`/`angle` so a shared course lands pre-filled; a normal new course passes empty strings (unchanged behavior).

### 5. Dashboard share control — `worker/src/pages.mjs`

- Each course card with a subject gains a **"Share"** action. Clicking it `POST`s `/api/courses/:id/share`, then shows the returned link inline for copying (read-only input + "copy"). Follows the existing event-delegation pattern (no inline `onclick`).

## Data flow summary

1. Sharer clicks Share → `shares` row created, link shown.
2. Recipient opens the link → (signed in: straight to a preset course; new: email → magic link → verify).
3. On verified accept: one use claimed atomically, email allowlisted, preset draft course created, redirect to prefilled onboarding.
4. Recipient completes onboarding → their own placement → their own course.

## Error handling

- **Invalid / full / unknown token:** the "no longer available" page; no link sent, no allowlist, no course.
- **Concurrent accepts at the cap:** `claimShareUse` is atomic (`WHERE uses < max_uses`), so total acceptances never exceed `max_uses`; the loser sees "full".
- **Share of a bare draft (no subject):** 400 "nothing to share yet".
- **Non-owner tries to share a course:** 404 (same as pause/resume on a non-owned course).
- **Unauthenticated `/api/courses/:id/share`:** 401.
- **Magic link for an unverified email:** allowlisting + use-consumption happen only at verify, so an unverified address is never allowlisted and never costs a use.

## Testing

- **db:** `createShare`/`getShare` round-trip; `claimShareUse` returns true up to `max_uses` then false; `createCourseWithSubject` sets subject+angle on a draft.
- **auth:** `mintToken` stores `share_token`; `consumeToken` returns `{ email, shareToken }` and keeps single-use.
- **routes:** `POST /api/courses/:id/share` (owner 200 + url; non-owner 404; bare draft 400; unauth 401); `GET /share/:token` (valid signed-in → 302 to onboarding + a use claimed; full → "full" page; unknown → unavailable); `/auth/request` with a valid non-full token mints+sends for a non-allowlisted email; with no/invalid token keeps allowlisted-only; `/auth/verify` with a share token claims a use, allowlists, creates the preset course, redirects to onboarding; a verify whose share filled in between shows "full".
- **render:** `renderOnboardHtml` prefills subject + angle (escaped) and seeds the JS payload; empty by default.
- **pages:** the dashboard course card exposes a Share control wired by delegation (no `onclick`).

## Out of scope / deferred

- Per-link custom caps or expiry (fixed `max_uses = 10`, no time expiry for v1).
- Showing the sharer who accepted / an acceptance count UI (the `uses` column holds the data; surfacing it is deferred).
- Copying the sharer's settings or progress (only subject + angle carry; recipient starts fresh).
- Revoking a share link before it fills.
