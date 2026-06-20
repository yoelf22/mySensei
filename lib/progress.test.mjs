import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recordQuiz,
  nextTarget,
  quizPassed,
  atMastery,
  needsMoreModules,
} from "./progress.mjs";

function baseCurriculum() {
  return {
    level: 4,
    startLevel: 4,
    settings: { passThreshold: 0.7 },
    outline: [
      { id: 1, title: "A", targetLevel: 5 },
      { id: 2, title: "B", targetLevel: 6 },
      { id: 3, title: "C", targetLevel: 10 },
    ],
    progress: { currentModule: 1, attempt: 1, status: "active", delivered: [], lastQuiz: null },
    trackHistory: [],
  };
}

test("nextTarget points at the current module", () => {
  const t = nextTarget(baseCurriculum());
  assert.equal(t.moduleId, 1);
  assert.equal(t.attempt, 1);
  assert.equal(t.module.title, "A");
});

test("quizPassed honors the threshold", () => {
  const c = baseCurriculum();
  assert.equal(quizPassed(c, 3, 4), true); // 0.75 >= 0.7
  assert.equal(quizPassed(c, 2, 4), false); // 0.5 < 0.7
  assert.equal(quizPassed(c, 1, 0), false); // guard divide-by-zero
});

test("passing advances the module and raises level to targetLevel", () => {
  const c = baseCurriculum();
  const next = recordQuiz(c, { module: 1, attempt: 1, score: 4, total: 4 });
  assert.equal(next.progress.currentModule, 2);
  assert.equal(next.progress.attempt, 1);
  assert.equal(next.level, 5);
  assert.equal(next.progress.lastQuiz.passed, true);
  // original is untouched (pure)
  assert.equal(c.progress.currentModule, 1);
});

test("failing re-teaches the same module and bumps attempt", () => {
  const c = baseCurriculum();
  const next = recordQuiz(c, { module: 1, attempt: 1, score: 1, total: 4 });
  assert.equal(next.progress.currentModule, 1);
  assert.equal(next.progress.attempt, 2);
  assert.equal(next.level, 4); // unchanged
  assert.equal(next.progress.lastQuiz.passed, false);
});

test("stale result (wrong attempt) is ignored", () => {
  const c = baseCurriculum();
  c.progress.attempt = 2;
  const next = recordQuiz(c, { module: 1, attempt: 1, score: 4, total: 4 });
  assert.equal(next, c); // unchanged reference
});

test("reaching level 10 flips to awaiting-specialization", () => {
  const c = baseCurriculum();
  c.progress.currentModule = 3;
  const next = recordQuiz(c, { module: 3, attempt: 1, score: 5, total: 5 });
  assert.equal(next.level, 10);
  assert.equal(next.progress.status, "awaiting-specialization");
  assert.equal(atMastery(next), true);
});

test("needsMoreModules is true past the last module below level 10", () => {
  const c = baseCurriculum();
  c.outline = [{ id: 1, title: "A", targetLevel: 6 }];
  c.progress.currentModule = 2; // past the only module
  assert.equal(needsMoreModules(c), true);
  c.level = 10;
  assert.equal(needsMoreModules(c), false); // mastery, not "need more"
});
