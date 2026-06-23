// worker/src/worker.mjs
import { isAllowlisted, createCourse, listCourses, getCourse, setStatus, countActive, getPage, courseToCurriculum, addToAllowlist, listAllowlist, removeFromAllowlist, createDispute, countInvitesBy } from "./db.mjs";
import { renderOnboardHtml } from "../../lib/render-onboard.mjs";
import { renderCourseIndexHtml } from "../../lib/render-course-index.mjs";
import { handleInternal } from "./internal.mjs";
import { signSession, verifySession, mintToken, consumeToken } from "./auth.mjs";
import { sendMagicLink, sendInvite } from "./email.mjs";
import { getCookie, sessionCookie } from "./cookies.mjs";
import { buildDispatch, buildDisputeRecord, postDispatch } from "./dispatch.mjs";
import { loginPage, dashboardPage, verifyPage } from "./pages.mjs";
import { runSweep } from "./sweep.mjs";

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...extra } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const INVITE_QUOTA = 5;

async function sessionEmail(request, env) {
  const tok = getCookie(request, "session");
  return tok ? verifySession(tok, env.SESSION_SECRET) : null;
}

function isOwner(email, env) {
  return !!email && email.toLowerCase() === String(env.OWNER_EMAIL || "").toLowerCase();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    const internalRes = await handleInternal(request, env, url);
    if (internalRes) return internalRes;

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (method === "POST" && pathname === "/auth/request") {
      let email = "";
      try { email = String((await request.json()).email || "").trim().toLowerCase(); } catch {}
      if (email && (await isAllowlisted(env, email))) {
        const token = await mintToken(env, email);
        await sendMagicLink(env, email, `${env.APP_BASE_URL}/auth/verify?token=${token}`);
      }
      return json({ ok: true }); // always 200 — no user enumeration
    }

    // GET shows a confirm page (a button that POSTs the token). Email link
    // scanners GET this without submitting the form, so they don't burn the
    // single-use token; only the human's click consumes it.
    if (method === "GET" && pathname === "/auth/verify") {
      const token = (url.searchParams.get("token") || "").replace(/[^a-z0-9]/gi, "");
      return new Response(verifyPage(token), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (method === "POST" && pathname === "/auth/verify") {
      const form = await request.formData();
      const email = await consumeToken(env, String(form.get("token") || ""));
      if (!email) return new Response("This link is invalid or expired. Request a new one.", { status: 400 });
      const cookie = sessionCookie(await signSession(email, env.SESSION_SECRET));
      return new Response(null, { status: 302, headers: { Location: "/dashboard", "Set-Cookie": cookie } });
    }

    if (pathname === "/api/courses") {
      const email = await sessionEmail(request, env);
      if (!email) return json({ error: "unauthorized" }, 401);
      if (method === "GET") {
        const owner = isOwner(email, env);
        const inviteRemaining = owner ? null : INVITE_QUOTA - (await countInvitesBy(env, email));
        return json({ courses: await listCourses(env, email), isOwner: owner, inviteRemaining });
      }
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

    if (pathname === "/api/invite" && method === "POST") {
      const email = await sessionEmail(request, env);
      if (!email) return json({ error: "unauthorized" }, 401);
      let body; try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
      const invitee = String(body.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invitee)) return json({ error: "invalid email" }, 400);
      const owner = isOwner(email, env);
      if (!owner && (await countInvitesBy(env, email)) >= INVITE_QUOTA) return json({ error: "no invites left" }, 403);
      const { inserted } = await addToAllowlist(env, invitee, email);
      if (inserted) await sendInvite(env, invitee);
      const remaining = owner ? null : INVITE_QUOTA - (await countInvitesBy(env, email));
      return json({ ok: true, email: invitee, already: !inserted, remaining });
    }

    if (pathname === "/api/allowlist") {
      const email = await sessionEmail(request, env);
      if (!email) return json({ error: "unauthorized" }, 401);
      if (!isOwner(email, env)) return json({ error: "forbidden" }, 403);
      if (method === "GET") return json({ emails: await listAllowlist(env) });
      return json({ error: "method not allowed" }, 405);
    }

    if (pathname === "/api/allowlist/remove" && method === "POST") {
      const email = await sessionEmail(request, env);
      if (!email) return json({ error: "unauthorized" }, 401);
      if (!isOwner(email, env)) return json({ error: "forbidden" }, 403);
      let body; try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
      const target = String(body.email || "").trim().toLowerCase();
      if (target === String(env.OWNER_EMAIL || "").toLowerCase()) return json({ error: "cannot remove owner" }, 400);
      await removeFromAllowlist(env, target);
      return json({ ok: true });
    }

    if (method === "POST" && pathname === "/submit") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400, CORS); }
      if (body.type === "dispute") {
        const rec = buildDisputeRecord(body);
        if (rec.error) return json({ error: rec.error }, 400, CORS);
        const { id, duplicate } = await createDispute(env, rec);
        if (duplicate) return json({ ok: true, duplicate: true }, 200, CORS);
        const gh2 = await postDispatch(env, "dispute", { courseId: rec.courseId, disputeId: id });
        if (!gh2.ok) return json({ error: "dispatch failed", status: gh2.status }, 502, CORS);
        return json({ ok: true }, 200, CORS);
      }
      const d = buildDispatch(body);
      if (d.error) return json({ error: d.error }, 400, CORS);
      const gh = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "mySensei-worker", "Content-Type": "application/json" },
        body: JSON.stringify({ event_type: d.event_type, client_payload: d.client_payload }),
      });
      if (!gh.ok) return json({ error: "dispatch failed", status: gh.status }, 502, CORS);
      return json({ ok: true }, 200, CORS);
    }

    const html = (s) => new Response(s, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (method === "GET" && pathname === "/") return html(loginPage());
    if (method === "GET" && pathname === "/dashboard") return html(dashboardPage());

    // Course contents page: the syllabus + every class created, served at /c/:id.
    const cm = pathname.match(/^\/c\/([a-z0-9]+)\/?$/);
    if (method === "GET" && cm) {
      const row = await getCourse(env, cm[1]);
      if (!row) return new Response("not found", { status: 404 });
      return html(renderCourseIndexHtml({ curriculum: courseToCurriculum(row), courseId: cm[1] }));
    }

    const pm = pathname.match(/^\/c\/([a-z0-9]+)\/(.+)$/);
    if (method === "GET" && pm) {
      const cid = pm[1], slug = pm[2];
      if (slug === "onboard") {
        const row = await getCourse(env, cid);
        if (!row) return new Response("not found", { status: 404 });
        return html(renderOnboardHtml({ webhookUrl: `${env.APP_BASE_URL}/submit`, courseId: cid }));
      }
      const page = await getPage(env, cid, slug);
      if (page == null) return new Response("not found", { status: 404 });
      return html(page);
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSweep(env, new Date(event.scheduledTime)));
  },
};
