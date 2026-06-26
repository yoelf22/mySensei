-- worker/migrations/0006_research.sql
-- A Research Project is a course row marked kind='research'. Its plan/draft
-- versions and the Socratic dialogue turns are append-only rows in
-- research_artifacts (document rows have version+citations; message rows have
-- role+content). Existing courses default to kind='course' and are untouched.
ALTER TABLE courses ADD COLUMN kind TEXT NOT NULL DEFAULT 'course';

CREATE TABLE research_artifacts (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  stage       TEXT NOT NULL,        -- 'plan' | 'draft' | 'final' | 'deck'
  type        TEXT NOT NULL,        -- 'plan' | 'draft' | 'final' | 'deck' | 'message'
  version     INTEGER,              -- document rows: 1,2,...; message rows: NULL
  role        TEXT,                 -- message rows: 'mysensei' | 'user'; documents: NULL
  content     TEXT,                 -- document body (text) or message text
  citations   TEXT,                 -- document rows: JSON [{title,url}]; else NULL
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_artifacts_project ON research_artifacts(project_id, created_at);
