import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "./report-failure.mjs";

test("records the error on the course and never throws (no mail creds → skips email)", async () => {
  process.env.COURSE_ID = "abc";
  process.env.APP_BASE_URL = "https://app.example";
  process.env.INTERNAL_TOKEN = "tok";
  delete process.env.MAIL_FROM; delete process.env.GMAIL_APP_PASSWORD; delete process.env.OWNER_EMAIL;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response("{}", { status: 200 }); };
  await run(); // must resolve, not reject
  assert.ok(calls.some((c) => /\/internal\/course\/abc\/error$/.test(c.url)));
});
