import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDeckHtml } from "./render-deck.mjs";
const slides = [{ heading: "Intro", point: "Tariffs raise prices", notes: "Explain the mechanism." }, { heading: "Evidence", point: "2025 data", notes: "Cite the studies." }];
test("renderDeckHtml is a full document with each slide and its notes", () => {
  const html = renderDeckHtml({ slides, courseId: "abc" });
  assert.match(html, /<!doctype html>/i);
  for (const f of ["Intro", "Tariffs raise prices", "Evidence", "Explain the mechanism."]) assert.match(html, new RegExp(f));
});
test("renderDeckHtml escapes slide content", () => {
  const html = renderDeckHtml({ slides: [{ heading: "<script>x</script>", point: "p", notes: "n" }], courseId: "abc" });
  assert.doesNotMatch(html, /<script>x<\/script>/);
});
