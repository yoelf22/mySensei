// worker/test/callbacks.test.mjs
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "../src/worker.mjs";

const E = { ...env, GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r" };
beforeEach(() => { globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })); });

it("quiz submit dispatches quiz-result with courseId + missed", async () => {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://app/submit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "quiz", courseId: "abc", module: 1, attempt: 1, score: 4, total: 5, missed: ["x"] }),
  }), E, ctx);
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(200);
  const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
  expect(body.event_type).toBe("quiz-result");
  expect(body.client_payload.courseId).toBe("abc");
  expect(body.client_payload.missed).toEqual(["x"]);
});
