// worker/test/schema.test.mjs
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("schema", () => {
  it("courses table has the expected columns", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(courses)").all();
    const cols = results.map((r) => r.name);
    for (const c of ["id","owner_email","subject","settings","status","start_level","level","research","assessment","outline","progress","last_error","created_at","updated_at"]) {
      expect(cols).toContain(c);
    }
  });
  it("allowlist + magic_tokens exist", async () => {
    await env.DB.prepare("INSERT INTO allowlist(email, added_at) VALUES('a@b.com','t')").run();
    const row = await env.DB.prepare("SELECT email FROM allowlist WHERE email='a@b.com'").first();
    expect(row.email).toBe("a@b.com");
  });
});
