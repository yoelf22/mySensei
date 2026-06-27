// worker/src/internal.mjs
import { getCourse, courseToCurriculum, saveCurriculum, putPage, setLastError, getDispute, resolveDispute, addArtifact as dbAddArtifact, listThread, latestDocument } from "./db.mjs";
import { mintToken } from "./auth.mjs";

export function internalOk(request, env) {
  return !!env.INTERNAL_TOKEN && request.headers.get("Authorization") === `Bearer ${env.INTERNAL_TOKEN}`;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

// Handle an /internal/* request. Returns a Response, or null if the path is not internal.
export async function handleInternal(request, env, url) {
  // Mint a one-click sign-in link for a notification email (e.g. "your research
  // plan is ready"). The GitHub Actions emailer can't reach D1 to mint a token
  // itself, so it asks the worker over this INTERNAL_TOKEN-guarded endpoint.
  if (url.pathname === "/internal/magic-link") {
    if (!internalOk(request, env)) return json({ error: "unauthorized" }, 401);
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) return json({ error: "missing email" }, 400);
    const token = await mintToken(env, email);
    return json({ url: `${env.APP_BASE_URL.replace(/\/+$/, "")}/auth/verify?token=${token}` });
  }

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

  const pfm = url.pathname.match(/^\/internal\/project\/([a-z0-9]+)\/file\/(pdf|docx|pptx)$/);
  if (pfm) {
    if (!internalOk(request, env)) return json({ error: "unauthorized" }, 401);
    if (request.method !== "PUT") return json({ error: "method not allowed" }, 405);
    const ct = request.headers.get("Content-Type") || "application/octet-stream";
    await env.DOCS.put(`${pfm[1]}/${pfm[2]}`, await request.arrayBuffer(), { httpMetadata: { contentType: ct } });
    return json({ ok: true });
  }

  const pm = url.pathname.match(/^\/internal\/project\/([a-z0-9]+)(\/artifact)?$/);
  if (pm) {
    if (!internalOk(request, env)) return json({ error: "unauthorized" }, 401);
    const pid = pm[1];
    if (pm[2] === "/artifact" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
      if (!body.stage || !body.type) return json({ error: "missing stage/type" }, 400);
      const { id } = await dbAddArtifact(env, {
        projectId: pid, stage: body.stage, type: body.type,
        version: body.version ?? null, role: body.role ?? null,
        content: String(body.content || ""), citations: body.citations ?? null,
      });
      return json({ ok: true, id });
    }
    if (pm[2] === "/artifact") return json({ error: "method not allowed" }, 405);
    if (request.method === "GET") {
      const row = await getCourse(env, pid);
      if (!row) return json({ error: "not found" }, 404);
      const [planDoc, draftDoc, draftJsonDoc] = await Promise.all([
        latestDocument(env, pid, "plan"),
        latestDocument(env, pid, "draft"),
        latestDocument(env, pid, "draft-json"),
      ]);
      return json({
        course: {
          ...courseToCurriculum(row),
          kind: row.kind,
          status: row.status,
          planVersion: planDoc?.version || 0,
          draftVersion: draftDoc?.version || 0,
          planDoc: planDoc?.content || "",
          draftDoc: draftDoc?.content || "",
          draftJson: draftJsonDoc?.content || "",
        },
        planThread: await listThread(env, pid, "plan"),
        draftThread: await listThread(env, pid, "draft"),
      });
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
