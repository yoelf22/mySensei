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

export async function addToAllowlist(env, email, invitedBy = null) {
  const res = await env.DB.prepare(
    "INSERT OR IGNORE INTO allowlist(email, added_at, invited_by) VALUES(?, ?, ?)",
  ).bind(norm(email), now(), invitedBy ? norm(invitedBy) : null).run();
  return { inserted: res.meta.changes === 1 };
}

export async function countInvitesBy(env, email) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM allowlist WHERE invited_by = ?",
  ).bind(norm(email)).first();
  return row.n;
}
export async function listAllowlist(env) {
  const { results } = await env.DB.prepare("SELECT email FROM allowlist ORDER BY added_at").all();
  return results.map((r) => r.email);
}
export async function removeFromAllowlist(env, email) {
  await env.DB.prepare("DELETE FROM allowlist WHERE email = ?").bind(norm(email)).run();
}
export async function setLastError(env, id, msg) {
  await env.DB.prepare("UPDATE courses SET last_error = ?, updated_at = ? WHERE id = ?").bind(msg || null, now(), id).run();
}

export async function createCourse(env, ownerEmail, subject = null, angle = null) {
  const id = randomId();
  const t = now();
  await env.DB.prepare(
    "INSERT INTO courses(id, owner_email, status, subject, angle, created_at, updated_at) VALUES(?,?,?,?,?,?,?)",
  ).bind(id, norm(ownerEmail), "draft", subject, angle, t, t).run();
  return { id };
}

export async function listActiveCourses(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, settings FROM courses WHERE status = 'active'",
  ).all();
  return results.map((r) => ({ id: r.id, settings: r.settings ? JSON.parse(r.settings) : {} }));
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
    ownerEmail: row.owner_email || "",
    subject: row.subject || "",
    angle: row.angle || "",
    startLevel: row.start_level,
    level: row.level,
    settings,
    researchContext: row.research || "",
    assessment,
    placement,
    outline: j(row.outline) || [],
    progress: j(row.progress) || { status: row.status || "draft" },
    syllabus: j(row.syllabus),
    trackHistory: [],
  };
}

export async function saveCurriculum(env, id, c) {
  const assessmentCol = JSON.stringify({ ...(c.assessment || {}), placement: c.placement ?? null });
  const status = (c.progress && c.progress.status) || "draft";
  await env.DB.prepare(
    `UPDATE courses SET subject=?, angle=?, settings=?, status=?, start_level=?, level=?,
       research=?, assessment=?, outline=?, progress=?, syllabus=?, last_error=NULL, updated_at=? WHERE id=?`,
  ).bind(
    c.subject || "", c.angle || "", JSON.stringify(c.settings || {}), status,
    c.startLevel ?? null, c.level ?? null, c.researchContext || "",
    assessmentCol, JSON.stringify(c.outline || []), JSON.stringify(c.progress || null),
    JSON.stringify(c.syllabus ?? null), now(), id,
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

export async function createDispute(env, { courseId, module, attempt, questionIndex, payload }) {
  const existing = await env.DB.prepare(
    "SELECT id FROM disputes WHERE course_id=? AND module=? AND attempt=? AND question_index=?",
  ).bind(courseId, module, attempt, questionIndex).first();
  if (existing) return { id: existing.id, duplicate: true };

  const id = randomId();
  await env.DB.prepare(
    "INSERT INTO disputes(id, course_id, module, attempt, question_index, payload, status, created_at) VALUES(?,?,?,?,?,?,?,?)",
  ).bind(id, courseId, module, attempt, questionIndex, JSON.stringify(payload), "open", now()).run();
  return { id, duplicate: false };
}

export async function getDispute(env, id) {
  const row = await env.DB.prepare("SELECT * FROM disputes WHERE id = ?").bind(id).first();
  if (!row) return null;
  return {
    ...row,
    payload: row.payload ? JSON.parse(row.payload) : null,
    ruling: row.ruling ? JSON.parse(row.ruling) : null,
  };
}

export async function resolveDispute(env, id, status, ruling) {
  await env.DB.prepare(
    "UPDATE disputes SET status=?, ruling=?, resolved_at=? WHERE id=?",
  ).bind(status, JSON.stringify(ruling ?? null), now(), id).run();
}

export async function createShare(env, { subject, angle, createdBy, maxUses = 10 }) {
  const token = randomId(24);
  await env.DB.prepare(
    "INSERT INTO shares(token, subject, angle, max_uses, uses, created_by, created_at) VALUES(?,?,?,?,0,?,?)",
  ).bind(token, subject, angle || null, maxUses, norm(createdBy), now()).run();
  return { token };
}

export async function getShare(env, token) {
  return env.DB.prepare("SELECT * FROM shares WHERE token = ?").bind(token).first();
}

export async function claimShareUse(env, token) {
  const res = await env.DB.prepare(
    "UPDATE shares SET uses = uses + 1 WHERE token = ? AND uses < max_uses",
  ).bind(token).run();
  return res.meta.changes === 1;
}
