-- A learner's challenge to one graded quiz question. One per (course, module,
-- attempt, question) — the unique constraint blocks duplicate disputes.
CREATE TABLE disputes (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  module INTEGER NOT NULL,
  attempt INTEGER NOT NULL,
  question_index INTEGER NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  ruling TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (course_id, module, attempt, question_index)
);
CREATE INDEX idx_disputes_course ON disputes(course_id);
