import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPaperHtml, renderPrintHtml } from "./render-paper.mjs";
const paper = { title: "Tariffs & Prices", subtitle: "A 2025 view", abstract: "Short abstract.", sections: [{ heading: "Background", body: "Para one.\n\nPara two." }], conclusion: "Done." };
const refs = [{ title: "Src A", url: "http://a" }];
test("renderPaperHtml includes title, sections, and references", () => {
  const html = renderPaperHtml(paper, refs);
  for (const f of ["Tariffs &amp; Prices", "Background", "Para one.", "References", "http://a"]) assert.match(html, new RegExp(f));
});
test("renderPaperHtml escapes user content", () => {
  const html = renderPaperHtml({ ...paper, sections: [{ heading: "H", body: "<script>x</script>" }] }, refs);
  assert.doesNotMatch(html, /<script>x<\/script>/);
});
test("renderPrintHtml is a full document", () => {
  assert.match(renderPrintHtml(paper, refs), /<!doctype html>/i);
});
