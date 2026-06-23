-- Track who invited each allowlisted user, to enforce a per-user invite quota.
-- Pre-existing (owner-seeded) rows keep invited_by NULL.
ALTER TABLE allowlist ADD COLUMN invited_by TEXT;
