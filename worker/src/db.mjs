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
