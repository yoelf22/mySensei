import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createCourse, getCourse, setKind, addArtifact, latestDocument, listThread, saveCurriculum } from "../src/db.mjs";

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

describe("research artifacts store", () => {
  it("setKind flips a course to research", async () => {
    const { id } = await createCourse(env, "me@x.com");
    await setKind(env, id, "research");
    expect((await getCourse(env, id)).kind).toBe("research");
  });
  it("createCourse accepts kind directly", async () => {
    const { id } = await createCourse(env, "me@x.com", "Tariffs", "", "research");
    expect((await getCourse(env, id)).kind).toBe("research");
  });
  it("latestDocument returns the highest version", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "research");
    await addArtifact(env, { projectId: id, stage: "plan", type: "plan", version: 1, content: "v1", citations: [{ title: "A", url: "http://a" }] });
    await addArtifact(env, { projectId: id, stage: "plan", type: "plan", version: 2, content: "v2", citations: [] });
    const doc = await latestDocument(env, id, "plan");
    expect(doc.version).toBe(2);
    expect(doc.content).toBe("v2");
  });
  it("latestDocument parses citations and returns null when none", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "research");
    expect(await latestDocument(env, id, "plan")).toBe(null);
    await addArtifact(env, { projectId: id, stage: "plan", type: "plan", version: 1, content: "v1", citations: [{ title: "A", url: "http://a" }] });
    expect((await latestDocument(env, id, "plan")).citations[0].url).toBe("http://a");
  });
  it("saveCurriculum persists kind when provided", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "course");
    await saveCurriculum(env, id, { subject: "T", kind: "research", progress: { status: "plan-talk" } });
    expect((await getCourse(env, id)).kind).toBe("research");
  });
  it("saveCurriculum without kind leaves existing kind unchanged", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "research");
    await saveCurriculum(env, id, { subject: "T", progress: { status: "plan-talk" } });
    expect((await getCourse(env, id)).kind).toBe("research");
  });
  it("listThread returns messages for a stage in order", async () => {
    const { id } = await createCourse(env, "me@x.com", "T", "", "research");
    await addArtifact(env, { projectId: id, stage: "plan", type: "message", role: "mysensei", content: "What is your thesis?" });
    await addArtifact(env, { projectId: id, stage: "plan", type: "message", role: "user", content: "That X causes Y." });
    await addArtifact(env, { projectId: id, stage: "draft", type: "message", role: "user", content: "different stage" });
    const thread = await listThread(env, id, "plan");
    expect(thread.map((m) => m.role)).toEqual(["mysensei", "user"]);
  });
});
