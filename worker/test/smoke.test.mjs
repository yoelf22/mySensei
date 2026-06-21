// worker/test/smoke.test.mjs
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.mjs";

describe("smoke", () => {
  it("D1 binding is present and queryable", async () => {
    const row = await env.DB.prepare("SELECT 1 AS ok").first();
    expect(row.ok).toBe(1);
  });
  it("unknown route returns 404", async () => {
    const req = new Request("https://x/nope");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});
