// lib/render-project.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderProjectHtml } from "./render-project.mjs";

const base = { courseId: "abc", webhookUrl: "http://h/submit", stage: "plan", status: "plan-talk",
  document: "THESIS\nX causes Y", thread: [{ role: "mysensei", content: "What is your thesis?" }, { role: "user", content: "X causes Y" }], downloads: null };

test("renders the document and the thread", () => {
  const html = renderProjectHtml(base);
  assert.match(html, /X causes Y/);
  assert.match(html, /What is your thesis\?/);
});
test("has message, regenerate and lock controls", () => {
  const html = renderProjectHtml(base);
  assert.match(html, /id="msg"/);
  assert.match(html, /data-act="regenerate"/);
  assert.match(html, /data-act="lock"/);
});
test("shows downloads + deck button when final-ready", () => {
  const html = renderProjectHtml({ ...base, status: "final-ready", downloads: { pdf: "/c/abc/download/pdf", docx: "/c/abc/download/docx" } });
  assert.match(html, /\/c\/abc\/download\/pdf/);
  assert.match(html, /data-act="deck"/);
});
