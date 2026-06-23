# User Invites — Design

Date: 2026-06-23
Status: Approved (brainstorming), pending implementation plan

## Problem

Today only the course owner can grow the allowlist: `/api/invite` is gated by
`isOwner`, and the dashboard shows the invite panel only to the owner. We want
any signed-in user to be able to invite others, without turning the allowlist
into uncapped open signup.

## Decisions (settled during brainstorming)

- **Every signed-in user can invite.** The `isOwner` gate on `/api/invite` is
  removed.
- **Non-owners get a fixed quota of 5 total invites.** The owner is unlimited.
- **Chaining is allowed:** an invited user gets their own quota of 5, so invites
  can spread outward. This is an accepted, eyes-open choice — growth is bounded
  per user (5 each) but can chain across hops.
- **Quota is tracked by an `invited_by` column on `allowlist`** (chosen over a
  separate `invites` table — redundant for this need). A user's spent invites =
  rows where `invited_by` = that user; remaining = `5 − spent`.
- **An already-allowlisted email is a no-op that does not consume quota.**
- **The full allowlist list and the remove action stay owner-only.** A non-owner
  never sees who else is on the list — only their own remaining count.

## Architecture

```
Dashboard (any signed-in user)
  GET /api/courses  → { courses, isOwner, inviteRemaining }   // remaining: number | null(owner)
  panel shown to everyone:
    owner    → existing panel (allowlist list + remove)
    non-owner→ invite box + "N of 5 invites left" (no list, no remove)
  POST /api/invite { email }
       → session required
       → non-owner: 403 if countInvitesBy(me) >= 5 (BEFORE insert)
       → addToAllowlist(email, invited_by = me) → { inserted }
       → inserted: sendInvite(email);  existing: no-op, no charge
       → returns { ok, email?, already?, remaining }
```

## Components

### 1. Data — `worker/src/db.mjs` + migration `worker/migrations/0004_invited_by.sql`

- **Migration:** `ALTER TABLE allowlist ADD COLUMN invited_by TEXT;`
  Existing rows (owner-seeded) keep `invited_by = NULL`.
- **`addToAllowlist(env, email, invitedBy)`** — `invitedBy` optional (defaults to
  `null`, preserving the owner-seed path). Must report whether a NEW row was
  inserted so the route can avoid charging quota for an already-present email.
  Return shape: `{ inserted: boolean }`. Implementation detects insertion (e.g.
  D1 `meta.changes === 1` after `INSERT OR IGNORE`, or a pre-`SELECT`).
- **`countInvitesBy(env, email)`** → `number` — `SELECT COUNT(*) FROM allowlist
  WHERE invited_by = ?` (normalized email).
- `listAllowlist` / `removeFromAllowlist` are unchanged.

### 2. Route — `worker/src/worker.mjs`

- **Constant** `INVITE_QUOTA = 5` (module scope in worker.mjs).
- **`POST /api/invite`:** keep the session-required check; **remove** the
  `isOwner` gate and the 403-forbidden branch. New flow:
  1. Validate the invitee email (existing regex → 400 on bad address).
  2. If NOT owner and `await countInvitesBy(env, me) >= INVITE_QUOTA` → return
     `{ error: "no invites left" }`, 403.
  3. `const { inserted } = await addToAllowlist(env, invitee, me)`.
  4. If `inserted` → `await sendInvite(env, invitee)`.
  5. Compute `remaining = isOwner ? null : INVITE_QUOTA - await countInvitesBy(env, me)`.
  6. Return `{ ok: true, email: invitee, already: !inserted, remaining }`.
  (Owner path: same, but the quota check in step 2 is skipped and `remaining` is
  `null`.)
- **`GET /api/courses`:** extend the existing response to include
  `inviteRemaining`: `isOwner ? null : INVITE_QUOTA - await countInvitesBy(env, me)`.
  `isOwner` stays as today.
- **`/api/allowlist` (GET) and `/api/allowlist/remove` (POST):** unchanged —
  still owner-gated.

### 3. Dashboard — `worker/src/pages.mjs`

- The `#invite` panel is shown to **every** signed-in user (not just the owner).
- On load (`/api/courses` response):
  - **Owner** (`isOwner === true`): render today's panel — the invite box plus
    the full allowlist with remove buttons (current `loadInvite()` behavior,
    which calls `/api/allowlist`).
  - **Non-owner:** render a lighter panel — the invite box plus a line
    "`N of 5 invites left`" sourced from `inviteRemaining`. Do **not** call
    `/api/allowlist`; do not render the list or remove buttons.
- `invite()` posts to `/api/invite`; on success it updates the remaining-count
  line from the response's `remaining` (owner: refresh the list as today). An
  `already: true` response shows "already invited" without decrementing.
- Quota-exhausted (403) shows "no invites left".

## Data flow

1. Any signed-in user loads the dashboard → `/api/courses` returns their
   `inviteRemaining`.
2. They submit an email → `/api/invite` enforces the quota (non-owner), records
   `invited_by`, sends the invite, returns the new `remaining`.
3. The invitee signs in via the existing magic-link flow (allowlist already
   gates it) and, being a normal user, gets their own quota of 5.

## Error handling

- **Invalid email:** existing 400 validation in the route.
- **Quota exhausted (non-owner):** 403 `{ error: "no invites left" }`, no insert,
  no email sent.
- **Already allowlisted:** `addToAllowlist` reports `inserted: false`; the route
  returns `{ ok: true, already: true }`, sends no email, charges no quota.
- **Unauthenticated:** existing 401 (no session).
- **Self-invite / inviting the owner:** falls out naturally — those emails are
  already on the allowlist, so it's a no-op.

## Testing

- **db (`worker/test/...`):** `invited_by` column persists; `addToAllowlist`
  returns `{ inserted: true }` for a new email and `{ inserted: false }` for an
  existing one, and stores `invited_by`; `countInvitesBy` counts only that
  user's invited rows.
- **worker routes:** a non-owner can invite up to 5 (each response's `remaining`
  decrements 4→0); the 6th returns 403 "no invites left"; the owner can invite
  past 5 with `remaining: null`; inviting an already-allowlisted email returns
  `already: true` and does not change `countInvitesBy`; `/api/courses` returns
  `inviteRemaining` as a number for a non-owner and `null` for the owner;
  `/api/allowlist` and remove remain owner-gated (403 for non-owner).
- **pages:** the non-owner dashboard renders the invite box + remaining line and
  does NOT render the allowlist list/remove controls.

## Out of scope / deferred

- Owner-configurable per-user quotas (a fixed 5 for v1).
- Invite audit trail / "who invited whom" UI (the `invited_by` column captures
  the data; surfacing it is deferred).
- Revoking a user's unused invites or clawing back invited members.
