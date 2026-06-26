import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createCourse, getCourse } from "../src/db.mjs";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM courses; DELETE FROM research_artifacts;");
});

describe("research migration", () => {
  it("courses default to kind=course", async () => {
    const { id } = await createCourse(env, "me@x.com");
    const got = await getCourse(env, id);
    expect(got.kind).toBe("course");
  });
  it("research_artifacts table exists and is empty", async () => {
    const { results } = await env.DB.prepare("SELECT * FROM research_artifacts").all();
    expect(results).toEqual([]);
  });
});
