// worker/src/sweep.mjs
import { shouldSendNow } from "../../lib/schedule.mjs";
import { listActiveCourses } from "./db.mjs";

// Pure: ids of the courses due to receive a lesson at `now`.
export function dueCourseIds(courses, now) {
  return courses.filter((c) => shouldSendNow(c.settings || {}, now)).map((c) => c.id);
}

async function fireDispatch(env, courseId) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "mySensei-worker",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: "lesson-due", client_payload: { courseId } }),
  });
  if (!res.ok) throw new Error(`lesson-due dispatch failed for ${courseId}: ${res.status}`);
}

export async function runSweep(env, now) {
  const courses = await listActiveCourses(env);
  const due = dueCourseIds(courses, now);
  const results = await Promise.allSettled(due.map((id) => fireDispatch(env, id)));
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`sweep dispatch failed for ${due[i]}:`, r.reason && r.reason.message);
  });
  return { dispatched: due };
}
