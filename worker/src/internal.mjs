// worker/src/internal.mjs
import { getCourse, courseToCurriculum, saveCurriculum, putPage } from "./db.mjs";

export function internalOk(request, env) {
  return !!env.INTERNAL_TOKEN && request.headers.get("Authorization") === `Bearer ${env.INTERNAL_TOKEN}`;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

// Handle an /internal/* request. Returns a Response, or null if the path is not internal.
export async function handleInternal(request, env, url) {
  const m = url.pathname.match(/^\/internal\/course\/([a-z0-9]+)(\/page)?$/);
  if (!m) return null;
  if (!internalOk(request, env)) return json({ error: "unauthorized" }, 401);
  const id = m[1];
  const isPage = !!m[2];

  if (isPage && request.method === "PUT") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    if (!body.path || typeof body.html !== "string") return json({ error: "missing path/html" }, 400);
    await putPage(env, id, String(body.path), body.html);
    return json({ ok: true });
  }
  if (isPage) return json({ error: "method not allowed" }, 405);

  if (request.method === "GET") {
    const row = await getCourse(env, id);
    if (!row) return json({ error: "not found" }, 404);
    return json(courseToCurriculum(row));
  }
  if (request.method === "PUT") {
    const row = await getCourse(env, id);
    if (!row) return json({ error: "not found" }, 404);
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    await saveCurriculum(env, id, body);
    return json({ ok: true });
  }
  return json({ error: "method not allowed" }, 405);
}
