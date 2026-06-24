// worker/test/auth.test.mjs
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { signSession, verifySession, mintToken, consumeToken } from "../src/auth.mjs";

const SECRET = "test-secret";
beforeEach(async () => { await env.DB.exec("DELETE FROM magic_tokens;"); });

describe("auth", () => {
  it("session round-trips and rejects tampering + expiry", async () => {
    const t = await signSession("me@x.com", SECRET, 1000);
    expect(await verifySession(t, SECRET, 2000)).toBe("me@x.com");
    expect(await verifySession(t + "x", SECRET, 2000)).toBe(null);
    expect(await verifySession(t, SECRET, 1000 + 31 * 86400 * 1000)).toBe(null);
  });
  it("magic token is single-use and expires", async () => {
    const tok = await mintToken(env, "me@x.com");
    expect(await consumeToken(env, tok)).toEqual({ email: "me@x.com", shareToken: null });
    expect(await consumeToken(env, tok)).toBe(null); // already used
    expect(await consumeToken(env, "bogus")).toBe(null);
  });
  it("magic token carries an optional share token", async () => {
    const tok = await mintToken(env, "a@x.com", "sharetok1");
    expect(await consumeToken(env, tok)).toEqual({ email: "a@x.com", shareToken: "sharetok1" });
  });
});
