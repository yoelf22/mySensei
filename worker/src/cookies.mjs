// worker/src/cookies.mjs
export function getCookie(request, name) {
  const h = request.headers.get("Cookie") || "";
  const m = h.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
export function sessionCookie(value) {
  return `session=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`;
}
