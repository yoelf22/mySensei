import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN_SCHEMA, planPrompt, planToText } from "./plan-model.mjs";

test("PLAN_SCHEMA requires the core fields", () => {
  assert.deepEqual(PLAN_SCHEMA.required.sort(), ["approach", "influences", "sources", "thesis"]);
});
test("planPrompt folds in the dialogue when present", () => {
  const p = planPrompt({ subject: "Tariffs", angle: "", settings: { language: "English", educationLevel: "graduate" }, thread: [{ role: "user", content: "Focus on 2025." }] });
  assert.match(p, /Tariffs/);
  assert.match(p, /Focus on 2025\./);
  assert.match(p, /revise/i);
});
test("planToText renders all sections", () => {
  const txt = planToText({ thesis: "T", influences: ["a", "b"], sources: ["s1"], approach: { initialConclusion: "ic", researchMethod: "rm", confirmationCriteria: "cc", fallbacks: "fb" } });
  for (const frag of ["T", "a", "b", "s1", "ic", "rm", "cc", "fb"]) assert.match(txt, new RegExp(frag));
});
