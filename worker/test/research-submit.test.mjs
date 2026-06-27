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

  async function lock(id) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://app/submit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "lock", courseId: id, stage: "plan" }),
    }), E, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("lock is held off (no status change) until mySensei judges the plan ready", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "research");
    await env.DB.prepare("UPDATE courses SET progress=? WHERE id=?")
      .bind(JSON.stringify({ status: "plan-talk", readyToLock: false, lockIssues: "Thesis is too vague." }), id).run();
    const res = await lock(id);
    expect(res.ok).toBe(true);
    const out = await res.json();
    expect(out.locked).toBe(false);
    expect(out.issues).toBe("Thesis is too vague.");
    expect((await getCourse(env, id)).status).not.toBe("drafting");
    expect(globalThis.fetch).not.toHaveBeenCalled(); // nothing dispatched
  });

  it("lock proceeds to drafting once mySensei marks it ready", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "research");
    await env.DB.prepare("UPDATE courses SET progress=? WHERE id=?")
      .bind(JSON.stringify({ status: "plan-talk", readyToLock: true, lockIssues: "" }), id).run();
    const res = await lock(id);
    expect(res.ok).toBe(true);
    expect((await getCourse(env, id)).status).toBe("drafting");
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.event_type).toBe("paper-due"); // paper generation dispatched
  });
});
