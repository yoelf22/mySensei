// worker/test/research-submit.test.mjs
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "../src/worker.mjs";
import { createCourse, listThread, getCourse } from "../src/db.mjs";

const E = { ...env, GITHUB_TOKEN: "t", GITHUB_OWNER: "o", GITHUB_REPO: "r" };
beforeEach(() => { globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })); });

describe("research /submit routes", () => {
  it("dialogue appends user message and fires dialogue event", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "research");
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://app/submit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "dialogue", courseId: id, stage: "plan", text: "hello" }),
    }), E, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.ok).toBe(true);
    const thread = await listThread(env, id, "plan");
    expect(thread).toHaveLength(1);
    expect(thread[0].role).toBe("user");
    expect(thread[0].content).toBe("hello");
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.event_type).toBe("dialogue");
  });

  it("lock plan sets status to drafting", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "research");
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://app/submit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "lock", courseId: id, stage: "plan" }),
    }), E, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.ok).toBe(true);
    const course = await getCourse(env, id);
    expect(course.status).toBe("drafting");
  });
});
