import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/worker.mjs";
import { createCourse } from "../src/db.mjs";
import { signSession } from "../src/auth.mjs";

const OWNER = "me@x.com";
const E = { ...env, SESSION_SECRET: "s" };
const cookie = async (email) => "session=" + (await signSession(email, "s"));

beforeEach(async () => { await env.DB.exec("DELETE FROM courses;"); });

describe("download route", () => {
  it("401 when unauthenticated", async () => {
    const { id } = await createCourse(env, OWNER, "T", "", "research");
    const res = await worker.fetch(new Request("https://app/c/" + id + "/download/pdf"), E);
    expect(res.status).toBe(401);
  });
  it("404 for a non-owner", async () => {
    const { id } = await createCourse(env, OWNER, "T", "", "research");
    await env.DOCS.put(`${id}/pdf`, "PDFBYTES");
    const res = await worker.fetch(new Request("https://app/c/" + id + "/download/pdf", { headers: { Cookie: await cookie("other@x.com") } }), E);
    expect(res.status).toBe(404);
  });
  it("owner downloads the stored pdf with attachment headers", async () => {
    const { id } = await createCourse(env, OWNER, "T", "", "research");
    await env.DOCS.put(`${id}/pdf`, "PDFBYTES");
    const res = await worker.fetch(new Request("https://app/c/" + id + "/download/pdf", { headers: { Cookie: await cookie(OWNER) } }), E);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment/);
    expect(await res.text()).toBe("PDFBYTES");
  });
  it("404 before the file exists", async () => {
    const { id } = await createCourse(env, OWNER, "T", "", "research");
    const res = await worker.fetch(new Request("https://app/c/" + id + "/download/pdf", { headers: { Cookie: await cookie(OWNER) } }), E);
    expect(res.status).toBe(404);
  });
});
