// worker/src/auth.mjs
import { now, randomId } from "./db.mjs";

const SESSION_DAYS = 30;
const TOKEN_MIN = 15;
const enc = new TextEncoder();

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
async function hmac(data, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function signSession(email, secret, nowMs = Date.now()) {
  const exp = nowMs + SESSION_DAYS * 86400 * 1000;
  const payload = `${email}.${exp}`;
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifySession(token, secret, nowMs = Date.now()) {
  const s = String(token || "");
  const last = s.lastIndexOf(".");
  if (last < 0) return null;
  const sig = s.slice(last + 1);
  const rest = s.slice(0, last);
  const mid = rest.lastIndexOf(".");
  if (mid < 0) return null;
  const exp = rest.slice(mid + 1);
  const email = rest.slice(0, mid);
  if ((await hmac(`${email}.${exp}`, secret)) !== sig) return null;
  if (Number(exp) < nowMs) return null;
  return email;
}

export async function mintToken(env, email) {
  const token = randomId(24);
  const expires = new Date(Date.now() + TOKEN_MIN * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO magic_tokens(token, email, expires_at, used) VALUES(?,?,?,0)")
    .bind(token, String(email).trim().toLowerCase(), expires).run();
  return token;
}

export async function consumeToken(env, token) {
  const row = await env.DB.prepare("SELECT email, expires_at, used FROM magic_tokens WHERE token = ?").bind(token).first();
  if (!row || row.used || row.expires_at < now()) return null;
  await env.DB.prepare("UPDATE magic_tokens SET used = 1 WHERE token = ?").bind(token).run();
  return row.email;
}
