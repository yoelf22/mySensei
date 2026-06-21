// worker/src/db.mjs
const JSON_COLS = ["settings", "assessment", "outline", "progress"];

export function now() { return new Date().toISOString(); }

export function randomId(len = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

function norm(email) { return String(email || "").trim().toLowerCase(); }

function parse(row) {
  if (!row) return null;
  const out = { ...row };
  for (const c of JSON_COLS) out[c] = row[c] ? JSON.parse(row[c]) : null;
  return out;
}

export async function isAllowlisted(env, email) {
  const row = await env.DB.prepare("SELECT email FROM allowlist WHERE email = ?").bind(norm(email)).first();
  return !!row;
}

export async function createCourse(env, ownerEmail) {
  const id = randomId();
  const t = now();
  await env.DB.prepare(
    "INSERT INTO courses(id, owner_email, status, created_at, updated_at) VALUES(?,?,?,?,?)",
  ).bind(id, norm(ownerEmail), "draft", t, t).run();
  return { id };
}

export async function listCourses(env, ownerEmail) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM courses WHERE owner_email = ? ORDER BY created_at DESC",
  ).bind(norm(ownerEmail)).all();
  return results.map(parse);
}

export async function getCourse(env, id) {
  return parse(await env.DB.prepare("SELECT * FROM courses WHERE id = ?").bind(id).first());
}

export async function setStatus(env, id, status) {
  await env.DB.prepare("UPDATE courses SET status = ?, updated_at = ? WHERE id = ?").bind(status, now(), id).run();
}

export async function countActive(env, ownerEmail) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM courses WHERE owner_email = ? AND status = 'active'",
  ).bind(norm(ownerEmail)).first();
  return row.n;
}

// Accepts EITHER a raw row (JSON columns as strings, e.g. from a direct
// SELECT) OR a parsed row (JSON columns already objects, e.g. from getCourse).
export function courseToCurriculum(row) {
  if (!row) return null;
  const j = (x) => (typeof x === "string" ? (x ? JSON.parse(x) : null) : (x ?? null));
  const settings = j(row.settings) || {};
  const assessmentCol = j(row.assessment) || {};
  const { placement = null, ...assessment } = assessmentCol;
  return {
    version: 1,
    subject: row.subject || "",
    angle: row.angle || "",
    startLevel: row.start_level,
    level: row.level,
    settings,
    researchContext: row.research || "",
    assessment,
    placement,
    outline: j(row.outline) || [],
    progress: j(row.progress),
    trackHistory: [],
  };
}

export async function saveCurriculum(env, id, c) {
  const assessmentCol = JSON.stringify({ ...(c.assessment || {}), placement: c.placement ?? null });
  const status = (c.progress && c.progress.status) || "draft";
  await env.DB.prepare(
    `UPDATE courses SET subject=?, angle=?, settings=?, status=?, start_level=?, level=?,
       research=?, assessment=?, outline=?, progress=?, updated_at=? WHERE id=?`,
  ).bind(
    c.subject || "", c.angle || "", JSON.stringify(c.settings || {}), status,
    c.startLevel ?? null, c.level ?? null, c.researchContext || "",
    assessmentCol, JSON.stringify(c.outline || []), JSON.stringify(c.progress || null),
    now(), id,
  ).run();
}

export async function getPage(env, courseId, path) {
  const row = await env.DB.prepare("SELECT html FROM pages WHERE course_id=? AND path=?").bind(courseId, path).first();
  return row ? row.html : null;
}

export async function putPage(env, courseId, path, html) {
  await env.DB.prepare(
    `INSERT INTO pages(course_id, path, html, updated_at) VALUES(?,?,?,?)
       ON CONFLICT(course_id, path) DO UPDATE SET html=excluded.html, updated_at=excluded.updated_at`,
  ).bind(courseId, path, html, now()).run();
}
