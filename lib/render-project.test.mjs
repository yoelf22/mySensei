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
test("lock is always clickable; hint says mySensei reviews first", () => {
  const html = renderProjectHtml(base);
  assert.doesNotMatch(html, /id="lockbtn"[^>]*disabled/);
  assert.match(html, /mySensei reviews it first/);
});
test("ready hint appears when mySensei judged it solid", () => {
  const html = renderProjectHtml({ ...base, ready: true });
  assert.match(html, /mySensei thinks this plan is solid/);
});
test("lock copy explains background + email, not interactive", () => {
  const html = renderProjectHtml(base);
  assert.match(html, /background/i);
  assert.match(html, /email you when/i);
});
test("shows downloads + deck button when final-ready", () => {
  const html = renderProjectHtml({ ...base, status: "final-ready", downloads: { pdf: "/c/abc/download/pdf", docx: "/c/abc/download/docx" } });
  assert.match(html, /\/c\/abc\/download\/pdf/);
  assert.match(html, /data-act="deck"/);
});
test("shows deck links when a deck is present (deck-ready)", () => {
  const html = renderProjectHtml({ courseId: "abc", webhookUrl: "http://h/submit", stage: "draft", status: "deck-ready",
    document: "paper", thread: [], downloads: { pdf: "/c/abc/download/pdf", docx: "/c/abc/download/docx" },
    deck: { pptx: "/c/abc/download/pptx", view: "/c/abc/deck" } });
  assert.match(html, /\/c\/abc\/download\/pptx/);
  assert.match(html, /\/c\/abc\/deck/);
});
