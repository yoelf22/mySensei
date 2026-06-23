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
