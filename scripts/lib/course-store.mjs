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

export async function reportError(courseId, msg) {
  try {
    await fetch(`${base()}/internal/course/${courseId}/error`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ error: String(msg || "") }),
    });
  } catch (e) {
    console.error("reportError failed:", e.message);
  }
}

export function submitUrl() {
  return `${base()}/submit`;
}

export async function fetchDispute(disputeId) {
  const r = await fetch(`${base()}/internal/dispute/${disputeId}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!r.ok) throw new Error(`fetchDispute ${disputeId}: ${r.status}`);
  return r.json();
}

export async function resolveDispute(disputeId, { status, ruling }) {
  const r = await fetch(`${base()}/internal/dispute/${disputeId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status, ruling }),
  });
  if (!r.ok) throw new Error(`resolveDispute ${disputeId}: ${r.status}`);
}

export async function fetchProject(projectId) {
  const r = await fetch(`${base()}/internal/project/${projectId}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!r.ok) throw new Error(`fetchProject ${projectId}: ${r.status}`);
  return r.json();
}

export async function putFile(projectId, fmt, buffer, contentType) {
  const r = await fetch(`${base()}/internal/project/${projectId}/file/${fmt}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": contentType },
    body: buffer,
  });
  if (!r.ok) throw new Error(`putFile ${projectId}/${fmt}: ${r.status}`);
}

export async function addArtifact(projectId, artifact) {
  const r = await fetch(`${base()}/internal/project/${projectId}/artifact`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(artifact),
  });
  if (!r.ok) throw new Error(`addArtifact ${projectId}: ${r.status}`);
  return r.json();
}
