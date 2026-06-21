// Apply a quiz result to the course stored in D1. Run by the record-quiz GitHub Action
// when the quiz helper fires a repository_dispatch; the workflow maps the
// client_payload into these env vars and commits the change afterward.
//
// Env: COURSE_ID, QUIZ_MODULE, QUIZ_ATTEMPT, QUIZ_SCORE, QUIZ_TOTAL

import { recordQuiz } from "../lib/progress.mjs";
import { fetchCourse, saveCourse } from "./lib/course-store.mjs";

const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }

function intEnv(name) {
  const v = parseInt(process.env[name] ?? "", 10);
  if (Number.isNaN(v)) {
    console.error(`Missing/invalid ${name}`);
    process.exit(1);
  }
  return v;
}

(async () => {
  const curriculum = await fetchCourse(COURSE_ID);
  let missed = [];
  try {
    const m = JSON.parse(process.env.QUIZ_MISSED || "[]");
    if (Array.isArray(m)) missed = m.map(String);
  } catch {
    missed = [];
  }

  const result = {
    module: intEnv("QUIZ_MODULE"),
    attempt: parseInt(process.env.QUIZ_ATTEMPT ?? "1", 10) || 1,
    score: intEnv("QUIZ_SCORE"),
    total: intEnv("QUIZ_TOTAL"),
    missed,
    at: new Date().toISOString(),
  };

  const next = recordQuiz(curriculum, result);
  if (next === curriculum) {
    console.log(`Stale or non-matching result for module ${result.module} (attempt ${result.attempt}) — ignored.`);
    return;
  }

  await saveCourse(COURSE_ID, next);
  console.log(
    `Recorded ${result.score}/${result.total} on module ${result.module}. ` +
    `Now: module ${next.progress.currentModule}, attempt ${next.progress.attempt}, level ${next.level}, status ${next.progress.status}.`,
  );
})().catch((e) => { console.error(e); process.exit(1); });
