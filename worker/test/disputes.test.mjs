import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createDispute, getDispute, resolveDispute } from "../src/db.mjs";

const payload = { question: "Q?", options: ["a", "b"], correctIndex: 1, chosenIndex: 0, concept: "c", explanation: "e", reason: "a works too" };

beforeEach(async () => { await env.DB.exec("DELETE FROM disputes;"); });

describe("disputes db", () => {
  it("creates, reads, and resolves a dispute", async () => {
    const { id, duplicate } = await createDispute(env, { courseId: "c1", module: 1, attempt: 1, questionIndex: 0, payload });
    expect(duplicate).toBe(false);
    const row = await getDispute(env, id);
    expect(row.course_id).toBe("c1");
    expect(row.status).toBe("open");
    expect(row.payload.reason).toBe("a works too");
    expect(row.ruling).toBe(null);

    await resolveDispute(env, id, "upheld", { verdict: "learner_correct", upheld: true });
    const after = await getDispute(env, id);
    expect(after.status).toBe("upheld");
    expect(after.ruling.verdict).toBe("learner_correct");
    expect(after.resolved_at).toBeTruthy();
  });

  it("rejects a duplicate dispute on the same question+attempt", async () => {
    const a = await createDispute(env, { courseId: "c1", module: 1, attempt: 1, questionIndex: 0, payload });
    const b = await createDispute(env, { courseId: "c1", module: 1, attempt: 1, questionIndex: 0, payload });
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
  });

  it("getDispute returns null for an unknown id", async () => {
    expect(await getDispute(env, "nope")).toBe(null);
  });
});

import worker from "../src/worker.mjs";
import { buildDisputeRecord } from "../src/dispatch.mjs";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";

describe("buildDisputeRecord", () => {
  const ok = { type: "dispute", courseId: "c1", module: 1, attempt: 1, questionIndex: 0, question: "Q", options: ["a", "b"], correctIndex: 1, chosenIndex: 0, concept: "c", explanation: "e", reason: "a works" };
  it("accepts a well-formed dispute", () => {
    const r = buildDisputeRecord(ok);
    expect(r.error).toBeUndefined();
    expect(r.payload.reason).toBe("a works");
    expect(r.questionIndex).toBe(0);
  });
  it("rejects a missing reason", () => {
    expect(buildDisputeRecord({ ...ok, reason: "  " }).error).toBeTruthy();
  });
  it("rejects a missing courseId", () => {
    expect(buildDisputeRecord({ ...ok, courseId: "" }).error).toBeTruthy();
  });
  it("rejects a non-integer questionIndex", () => {
    expect(buildDisputeRecord({ ...ok, questionIndex: "x" }).error).toBeTruthy();
  });
});

describe("/submit dispute branch", () => {
  const E = { ...env, GITHUB_OWNER: "o", GITHUB_REPO: "r", GITHUB_TOKEN: "t" };
  const body = { type: "dispute", courseId: "c1", module: 1, attempt: 1, questionIndex: 0, question: "Q", options: ["a", "b"], correctIndex: 1, chosenIndex: 0, concept: "c", explanation: "e", reason: "a works too" };
  async function submit(env2, b) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://app/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }), env2, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("stores the dispute and reports a duplicate on the second submit", async () => {
    await env.DB.exec("DELETE FROM disputes;");
    // Stub the GitHub dispatch so no real network call happens.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    try {
      const r1 = await submit(E, body);
      expect(r1.status).toBe(200);
      const j1 = await r1.json();
      expect(j1.ok).toBe(true);
      expect(j1.duplicate).toBeFalsy();

      const r2 = await submit(E, body);
      const j2 = await r2.json();
      expect(j2.duplicate).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
    const { results } = await env.DB.prepare("SELECT id FROM disputes WHERE course_id='c1'").all();
    expect(results.length).toBe(1);
  });

  it("rejects an invalid dispute with 400", async () => {
    const r = await submit(E, { ...body, reason: "" });
    expect(r.status).toBe(400);
  });
});

describe("internal dispute API", () => {
  const TOKEN = "tok-int";
  const E = { ...env, INTERNAL_TOKEN: TOKEN };
  const auth = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" };
  async function call(path, init) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://app" + path, init), E, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("GET returns the dispute; PUT resolves it; 401 without the token", async () => {
    await env.DB.exec("DELETE FROM disputes;");
    const { id } = await createDispute(env, { courseId: "c9", module: 1, attempt: 1, questionIndex: 0, payload });
    expect((await call(`/internal/dispute/${id}`, {})).status).toBe(401);

    const got = await call(`/internal/dispute/${id}`, { headers: auth });
    expect(got.status).toBe(200);
    expect((await got.json()).course_id).toBe("c9");

    const put = await call(`/internal/dispute/${id}`, { method: "PUT", headers: auth, body: JSON.stringify({ status: "rejected", ruling: { verdict: "stands", upheld: false } }) });
    expect(put.status).toBe(200);
    const after = await getDispute(env, id);
    expect(after.status).toBe("rejected");
  });

  it("GET an unknown dispute id is 404", async () => {
    expect((await call(`/internal/dispute/nope`, { headers: auth })).status).toBe(404);
  });
});
