-- worker/migrations/0001_init.sql
CREATE TABLE allowlist (email TEXT PRIMARY KEY, added_at TEXT NOT NULL);
CREATE TABLE learners (email TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  subject TEXT, angle TEXT,
  settings TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  start_level INTEGER, level INTEGER,
  research TEXT, assessment TEXT, outline TEXT, progress TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_courses_owner ON courses(owner_email);
CREATE INDEX idx_courses_status ON courses(status);
CREATE TABLE magic_tokens (token TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE pages (course_id TEXT NOT NULL, path TEXT NOT NULL, html TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (course_id, path));
