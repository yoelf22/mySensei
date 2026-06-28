import { test } from "node:test";
import assert from "node:assert/strict";
import { PAPER_OUTLINE_SCHEMA, outlinePrompt, sectionPrompt, conclusionPrompt, paperToText, renderReferences } from "./paper-model.mjs";

test("outline schema requires title + headings", () => {
  assert.ok(PAPER_OUTLINE_SCHEMA.required.includes("title"));
  assert.ok(PAPER_OUTLINE_SCHEMA.required.includes("headings"));
});
test("outline schema caps sections so the job stays bounded", () => {
  assert.equal(PAPER_OUTLINE_SCHEMA.properties.headings.maxItems, 6);
});
test("outlinePrompt grounds in the plan text", () => {
  const p = outlinePrompt({ planText: "THESIS: tariffs raise prices", settings: { language: "English", educationLevel: "graduate" } });
  assert.match(p, /THESIS: tariffs raise prices/);
});
test("sectionPrompt names the heading and grounds in the plan", () => {
  const p = sectionPrompt({ subject: "Tariffs", settings: { language: "English" }, planText: "THESIS X", heading: "Background", priorText: "" });
  assert.match(p, /Background/);
  assert.match(p, /THESIS X/);
});
test("conclusionPrompt references the body", () => {
  const p = conclusionPrompt({ subject: "Tariffs", settings: { language: "English" }, planText: "THESIS X", bodyText: "BODY SO FAR" });
  assert.match(p, /BODY SO FAR/);
});
test("paperToText includes title, subtitle, abstract, sections, conclusion, and numbered references", () => {
  const txt = paperToText({ title: "T", subtitle: "S", abstract: "A", sections: [{ heading: "H1", body: "B1" }], conclusion: "C" }, [{ title: "Src", url: "http://s" }]);
  for (const f of ["T", "S", "A", "H1", "B1", "C", "References", "Src", "http://s"]) assert.match(txt, new RegExp(f));
});
test("renderReferences numbers entries 1-based", () => {
  const r = renderReferences([{ title: "A", url: "http://a" }, { title: "B", url: "http://b" }]);
  assert.match(r, /\[1\] A — http:\/\/a/);
  assert.match(r, /\[2\] B — http:\/\/b/);
});
test("renderReferences handles empty list", () => {
  assert.equal(renderReferences([]), "");
});
test("outlinePrompt folds in the draft dialogue when present", () => {
  const p = outlinePrompt({ planText: "P", settings: {}, thread: [{ role: "user", content: "Add a methods section." }] });
  assert.match(p, /Add a methods section\./);
  assert.match(p, /REVISE/);
});
