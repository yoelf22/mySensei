import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchCourse, saveCourse, savePage, submitUrl } from "./course-store.mjs";

function setEnv() { process.env.APP_BASE_URL = "https://app.example/"; process.env.INTERNAL_TOKEN = "tok"; }

test("fetchCourse GETs with bearer and returns JSON", async () => {
  setEnv();
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ subject: "S" }), { status: 200 }); };
  const c = await fetchCourse("abc");
  assert.equal(c.subject, "S");
  assert.match(calls[0].url, /\/internal\/course\/abc$/);
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
});

test("saveCourse PUTs the curriculum and throws on non-ok", async () => {
  setEnv();
  let body;
  globalThis.fetch = async (url, init) => { body = JSON.parse(init.body); return new Response("{}", { status: 200 }); };
  await saveCourse("abc", { subject: "S" });
  assert.equal(body.subject, "S");
  globalThis.fetch = async () => new Response("nope", { status: 500 });
  await assert.rejects(() => saveCourse("abc", {}), /saveCourse abc: 500/);
});

test("savePage PUTs {path, html}", async () => {
  setEnv();
  let body;
  globalThis.fetch = async (url, init) => { body = JSON.parse(init.body); return new Response("{}", { status: 200 }); };
  await savePage("abc", "assessment", "<h1>x</h1>");
  assert.equal(body.path, "assessment");
  assert.equal(body.html, "<h1>x</h1>");
});

test("submitUrl trims the trailing slash on the base", () => {
  setEnv();
  assert.equal(submitUrl(), "https://app.example/submit");
});
