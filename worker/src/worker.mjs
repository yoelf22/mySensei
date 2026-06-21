// mySensei helper (Cloudflare Worker).
// Receives form/quiz submissions from the hosted pages and turns them into a
// GitHub repository_dispatch, holding the GitHub token safely server-side.
//
// Routes by the POST body's `type`:
//   (none) / "quiz"  -> event "quiz-result"        { module, attempt, score, total }
//   "onboard"        -> event "onboard"            { subject, angle, settings... }
//   "assessment"     -> event "assessment-result"  { results: [{level, correct}] }
//
// Secrets/vars (wrangler): GITHUB_TOKEN (secret, Contents: write),
//   GITHUB_OWNER, GITHUB_REPO (plain vars).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function buildDispatch(body) {
  const type = body.type || "quiz";

  if (type === "onboard") {
    if (!body.subject || typeof body.subject !== "string") return { error: "missing subject" };
    if (!body.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) return { error: "missing or invalid email" };
    return {
      event_type: "onboard",
      client_payload: {
        subject: body.subject,
        email: body.email,
        angle: body.angle || "",
        language: body.language || "English",
        languageCode: body.languageCode || "en",
        chunkMinutes: Number(body.chunkMinutes) || 10,
        cadence: body.cadence === "weekly" ? "weekly" : "daily",
        deliveryTime: body.deliveryTime || "07:00",
        timezone: body.timezone || "UTC",
        workweekDays: Array.isArray(body.workweekDays) ? body.workweekDays : [0, 1, 2, 3, 4, 5, 6],
      },
    };
  }

  if (type === "assessment") {
    if (!Array.isArray(body.results) || body.results.length === 0) return { error: "missing results" };
    const results = body.results.map((r) => ({ level: Number(r.level), correct: !!r.correct }));
    return { event_type: "assessment-result", client_payload: { results } };
  }

  // quiz (default)
  const module = Number(body.module), attempt = Number(body.attempt) || 1;
  const score = Number(body.score), total = Number(body.total);
  if (![module, score, total].every(Number.isInteger) || total <= 0 || score < 0 || score > total) {
    return { error: "invalid result" };
  }
  return { event_type: "quiz-result", client_payload: { module, attempt, score, total } };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "POST") return json(405, { error: "method not allowed" });

    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "invalid JSON" });
    }

    const d = buildDispatch(body);
    if (d.error) return json(400, { error: d.error });

    const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`;
    const gh = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "mySensei-helper",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event_type: d.event_type, client_payload: d.client_payload }),
    });

    if (!gh.ok) {
      const detail = (await gh.text()).slice(0, 200);
      return json(502, { error: "dispatch failed", status: gh.status, detail });
    }
    return json(200, { ok: true });
  },
};
