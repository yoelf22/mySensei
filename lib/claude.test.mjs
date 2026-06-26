// lib/claude.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSources } from "./claude.mjs";

test("extractSources pulls web_search_tool_result urls", () => {
  const content = [
    { type: "server_tool_use", name: "web_search" },
    { type: "web_search_tool_result", content: [
      { type: "web_search_result", url: "https://a.org/x", title: "A" },
      { type: "web_search_result", url: "https://b.org/y", title: "B" },
    ] },
    { type: "text", text: "hello", citations: [
      { type: "web_search_result_location", url: "https://a.org/x", title: "A" },
    ] },
  ];
  const s = extractSources(content);
  assert.equal(s.length, 2); // deduped on url
  assert.deepEqual(s.map((x) => x.url).sort(), ["https://a.org/x", "https://b.org/y"]);
});
test("extractSources tolerates missing fields", () => {
  assert.deepEqual(extractSources([]), []);
  assert.deepEqual(extractSources([{ type: "text", text: "no citations" }]), []);
});
