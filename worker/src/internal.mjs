// worker/src/internal.mjs
import { getCourse, courseToCurriculum, saveCurriculum, putPage, setLastError, getDispute, resolveDispute } from "./db.mjs";

export function internalOk(request, env) {
  return !!env.INTERNAL_TOKEN && request.headers.get("Authorization") === `Bearer ${env.INTERNAL_TOKEN}`;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

// Handle an /internal/* request. Returns a Response, or null if the path is not internal.
export async function handleInternal(request, env, url) {
  const dm = url.pathname.match(/^\/internal\/dispute\/([a-z0-9]+)$/);
  if (dm) {
    if (!internalOk(request, env)) return json({ error: "unauthorized" }, 401);
    const did = dm[1];
    if (request.method === "GET") {
      const row = await getDispute(env, did);
      if (!row) return json({ error: "not found" }, 404);
      return json(row);
    }
    if (request.method === "PUT") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
      await resolveDispute(env, did, String(body.status || "open"), body.ruling ?? null);
      return json({ ok: true });
    }
    return json({ error: "method not allowed" }, 405);
  }

  const m = url.pathname.match(/^\/internal\/course\/([a-z0-9]+)(\/page|\/error)?$/);
  if (!m) return null;
  if (!internalOk(request, env)) return json({ error: "unauthorized" }, 401);
  const id = m[1];
  const sub = m[2]; // undefined | "/page" | "/error"

  if (sub === "/page" && request.method === "PUT") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    if (!body.path || typeof body.html !== "string") return json({ error: "missing path/html" }, 400);
    await putPage(env, id, String(body.path), body.html);
    return json({ ok: true });
  }
  if (sub === "/page") return json({ error: "method not allowed" }, 405);

  if (sub === "/error" && request.method === "PUT") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    await setLastError(env, id, String(body.error || ""));
    return json({ ok: true });
  }
  if (sub === "/error") return json({ error: "method not allowed" }, 405);

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
