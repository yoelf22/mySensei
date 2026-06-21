// worker/src/email.mjs
export async function sendMagicLink(env, email, url) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "mySensei-worker",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: "send-mail",
      client_payload: {
        to: email,
        subject: "mySensei — your sign-in link",
        intro: "Click to sign in to your mySensei dashboard. This link expires in 15 minutes.",
        url,
      },
    }),
  });
  if (!res.ok) throw new Error(`dispatch failed: ${res.status}`);
}
