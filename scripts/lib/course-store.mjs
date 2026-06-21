// scripts/lib/course-store.mjs
// HTTP client to the Worker internal API. Replaces curriculum.json file I/O.
// Env: APP_BASE_URL (worker origin), INTERNAL_TOKEN (shared secret).
function base() {
  const b = process.env.APP_BASE_URL;
  if (!b) throw new Error("APP_BASE_URL is not set");
  return b.replace(/\/+$/, "");
}
function token() {
  const t = process.env.INTERNAL_TOKEN;
  if (!t) throw new Error("INTERNAL_TOKEN is not set");
  return t;
}

export async function fetchCourse(courseId) {
  const r = await fetch(`${base()}/internal/course/${courseId}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!r.ok) throw new Error(`fetchCourse ${courseId}: ${r.status}`);
  return r.json();
}

export async function saveCourse(courseId, curriculum) {
  const r = await fetch(`${base()}/internal/course/${courseId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(curriculum),
  });
  if (!r.ok) throw new Error(`saveCourse ${courseId}: ${r.status}`);
}

export async function savePage(courseId, path, html) {
  const r = await fetch(`${base()}/internal/course/${courseId}/page`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path, html }),
  });
  if (!r.ok) throw new Error(`savePage ${courseId}/${path}: ${r.status}`);
}

export function submitUrl() {
  return `${base()}/submit`;
}
