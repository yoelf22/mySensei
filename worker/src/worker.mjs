// mySensei quiz helper (Cloudflare Worker).
// The lesson page POSTs the quiz result here; this holds the GitHub token
// safely and fires a repository_dispatch to trigger the next-lesson workflow.
//
// Secrets/vars (set with wrangler): GITHUB_TOKEN (secret, Contents: write),
//   GITHUB_OWNER, GITHUB_REPO (plain vars).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
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

    const module = Number(body.module);
    const attempt = Number(body.attempt) || 1;
    const score = Number(body.score);
    const total = Number(body.total);
    if (![module, score, total].every(Number.isInteger) || total <= 0 || score < 0 || score > total) {
      return json(400, { error: "invalid result" });
    }

    const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`;
    const gh = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "mySensei-quiz-helper",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "quiz-result",
        client_payload: { module, attempt, score, total },
      }),
    });

    if (!gh.ok) {
      const detail = (await gh.text()).slice(0, 200);
      return json(502, { error: "dispatch failed", status: gh.status, detail });
    }
    return json(200, { ok: true });
  },
};
