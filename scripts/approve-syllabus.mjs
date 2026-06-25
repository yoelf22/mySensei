// Flip a course from awaiting-approval to active when the learner approves the
// syllabus. Run by the start-lessons workflow before generating lesson 1.
// Env: COURSE_ID, APP_BASE_URL, INTERNAL_TOKEN.

import { fetchCourse, saveCourse } from "./lib/course-store.mjs";

const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }

(async () => {
  const curriculum = await fetchCourse(COURSE_ID);
  const status = curriculum.progress && curriculum.progress.status;
  if (status !== "awaiting-approval") {
    console.log(`Course ${COURSE_ID} is not awaiting approval (status ${status}) — nothing to do.`);
    return;
  }
  curriculum.progress.status = "active";
  await saveCourse(COURSE_ID, curriculum);
  console.log(`Approved course ${COURSE_ID}: now active.`);
})().catch((e) => { console.error(e); process.exit(1); });
