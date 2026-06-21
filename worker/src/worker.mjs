// worker/src/worker.mjs
import { isAllowlisted, createCourse, listCourses, getCourse, setStatus, countActive } from "./db.mjs";
import { signSession, verifySession, mintToken, consumeToken } from "./auth.mjs";
import { sendMagicLink } from "./email.mjs";
import { getCookie, sessionCookie } from "./cookies.mjs";

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...extra } });

async function sessionEmail(request, env) {
  const tok = getCookie(request, "session");
  return tok ? verifySession(tok, env.SESSION_SECRET) : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (method === "POST" && pathname === "/auth/request") {
      let email = "";
      try { email = String((await request.json()).email || "").trim().toLowerCase(); } catch {}
      if (email && (await isAllowlisted(env, email))) {
        const token = await mintToken(env, email);
        await sendMagicLink(env, email, `${env.APP_BASE_URL}/auth/verify?token=${token}`);
      }
      return json({ ok: true }); // always 200 — no user enumeration
    }

    if (method === "GET" && pathname === "/auth/verify") {
      const email = await consumeToken(env, url.searchParams.get("token") || "");
      if (!email) return new Response("This link is invalid or expired. Request a new one.", { status: 400 });
      const cookie = sessionCookie(await signSession(email, env.SESSION_SECRET));
      return new Response(null, { status: 302, headers: { Location: "/dashboard", "Set-Cookie": cookie } });
    }

    if (pathname === "/api/courses") {
      const email = await sessionEmail(request, env);
      if (!email) return json({ error: "unauthorized" }, 401);
      if (method === "GET") return json({ courses: await listCourses(env, email) });
      if (method === "POST") return json(await createCourse(env, email));
      return json({ error: "method not allowed" }, 405);
    }

    const m = pathname.match(/^\/api\/courses\/([a-z0-9]+)\/(pause|resume)$/);
    if (m && method === "POST") {
      const email = await sessionEmail(request, env);
      if (!email) return json({ error: "unauthorized" }, 401);
      const course = await getCourse(env, m[1]);
      if (!course || course.owner_email !== email) return json({ error: "not found" }, 404);
      if (m[2] === "pause") { await setStatus(env, course.id, "paused"); return json({ ok: true }); }
      if ((await countActive(env, email)) >= 3) return json({ error: "cap" }, 409);
      await setStatus(env, course.id, "active");
      return json({ ok: true });
    }

    return new Response("not found", { status: 404 });
  },
};
