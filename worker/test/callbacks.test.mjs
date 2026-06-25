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

it("onboard nests settings (incl. educationLevel) and stays within GitHub's 10-property client_payload cap", async () => {
  const ctx = createExecutionContext();
  await worker.fetch(new Request("https://app/submit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "onboard", courseId: "abc", subject: "Art", educationLevel: "graduate" }),
  }), E, ctx);
  await waitOnExecutionContext(ctx);
  const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
  expect(body.event_type).toBe("onboard");
  expect(body.client_payload.settings.educationLevel).toBe("graduate");
  // GitHub rejects (422) a client_payload with more than 10 top-level properties.
  expect(Object.keys(body.client_payload).length).toBeLessThanOrEqual(10);
});

it("onboard defaults educationLevel to undergraduate when absent", async () => {
  const ctx = createExecutionContext();
  await worker.fetch(new Request("https://app/submit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "onboard", courseId: "abc", subject: "Art" }),
  }), E, ctx);
  await waitOnExecutionContext(ctx);
  const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
  expect(body.client_payload.settings.educationLevel).toBe("undergraduate");
});

import { buildDispatch as bd2 } from "../src/dispatch.mjs";

describe("calibration dispatch", () => {
  it("onboard carries the domain in settings", () => {
    const d = bd2({ type: "onboard", courseId: "c1", subject: "Chess", domain: "arts-humanities" });
    expect(d.client_payload.settings.domain).toBe("arts-humanities");
  });
  it("onboard defaults domain to other", () => {
    const d = bd2({ type: "onboard", courseId: "c1", subject: "Chess" });
    expect(d.client_payload.settings.domain).toBe("other");
  });
  it("adjust validates direction and maps to syllabus-adjust", () => {
    const up = bd2({ type: "adjust", courseId: "c1", direction: "up" });
    expect(up.event_type).toBe("syllabus-adjust");
    expect(up.client_payload).toEqual({ courseId: "c1", direction: "up" });
    expect(bd2({ type: "adjust", courseId: "c1", direction: "sideways" }).error).toBeTruthy();
  });
});
