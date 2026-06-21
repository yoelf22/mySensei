// worker/test/email.test.mjs
import { describe, it, expect, vi } from "vitest";
import { sendMagicLink } from "../src/email.mjs";

describe("email dispatch", () => {
  it("fires a send-mail repository_dispatch with the login link", async () => {
    const calls = [];
    const env = { GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r" };
    globalThis.fetch = vi.fn(async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response("{}", { status: 200 }); });
    await sendMagicLink(env, "me@x.com", "https://app/auth/verify?token=abc");
    expect(calls[0].url).toContain("/repos/o/r/dispatches");
    expect(calls[0].body.event_type).toBe("send-mail");
    expect(calls[0].body.client_payload.to).toBe("me@x.com");
    expect(calls[0].body.client_payload.url).toContain("token=abc");
  });
});
