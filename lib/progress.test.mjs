import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recordQuiz,
  amendQuiz,
  nextTarget,
  quizPassed,
  atMastery,
  needsMoreModules,
  alreadyDelivered,
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

test("recordQuiz stores missed concepts in lastQuiz", () => {
  const c = baseCurriculum();
  const next = recordQuiz(c, { module: 1, attempt: 1, score: 1, total: 4, missed: ["ability to pay", "VAT regressivity"] });
  assert.deepEqual(next.progress.lastQuiz.missedConcepts, ["ability to pay", "VAT regressivity"]);
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

test("alreadyDelivered matches a delivered lesson by module + attempt", () => {
  const c = { progress: { delivered: [{ module: 1, attempt: 1, lessonFile: "lesson-01-attempt1" }] } };
  assert.equal(alreadyDelivered(c, { moduleId: 1, attempt: 1 }), true);   // same lesson — waiting on the quiz
  assert.equal(alreadyDelivered(c, { moduleId: 1, attempt: 2 }), false);  // re-teach (fail) — fresh
  assert.equal(alreadyDelivered(c, { moduleId: 2, attempt: 1 }), false);  // advanced (pass) — fresh
});

test("alreadyDelivered is false when nothing was delivered yet", () => {
  assert.equal(alreadyDelivered({ progress: {} }, { moduleId: 1, attempt: 1 }), false);
  assert.equal(alreadyDelivered({ progress: { delivered: [] } }, { moduleId: 1, attempt: 1 }), false);
});

// --- amendQuiz ---------------------------------------------------------------

function failedCurriculum() {
  // module 1 was failed 1/3; recordQuiz left currentModule=1, attempt=2.
  const c = baseCurriculum();
  c.progress.currentModule = 1;
  c.progress.attempt = 2;
  c.progress.lastQuiz = { module: 1, attempt: 1, score: 1, total: 3, passed: false, missedConcepts: ["grip", "stance"], at: "t" };
  return c;
}

test("amendQuiz credits a failed quiz and, when it now passes, advances", () => {
  const next = amendQuiz(failedCurriculum(), { module: 1, attempt: 1, creditConcept: "grip" });
  assert.notEqual(next, failedCurriculum());
  assert.equal(next.progress.lastQuiz.score, 2); // 1 -> 2 of 3 = pass (>=0.7? 0.66 no)
  // 2/3 = 0.666 < 0.7 so still failing:
  assert.equal(next.progress.lastQuiz.passed, false);
  assert.equal(next.progress.currentModule, 1);
  assert.deepEqual(next.progress.lastQuiz.missedConcepts, ["stance"]); // credited concept removed
});

test("amendQuiz that flips fail->pass advances module, resets attempt, raises level", () => {
  const c = failedCurriculum();
  c.progress.lastQuiz.score = 2; // 2/3, credit -> 3/3 pass
  const next = amendQuiz(c, { module: 1, attempt: 1, creditConcept: "grip" });
  assert.equal(next.progress.lastQuiz.score, 3);
  assert.equal(next.progress.lastQuiz.passed, true);
  assert.equal(next.progress.currentModule, 2);
  assert.equal(next.progress.attempt, 1);
  assert.equal(next.level, 5); // module 1 targetLevel
});

test("amendQuiz ignores a stale/moved-on dispute (no matching lastQuiz)", () => {
  const c = failedCurriculum();
  const same = amendQuiz(c, { module: 1, attempt: 99, creditConcept: "grip" });
  assert.equal(same, c);
});

test("amendQuiz ignores a quiz that already passed", () => {
  const c = failedCurriculum();
  c.progress.lastQuiz.passed = true;
  const same = amendQuiz(c, { module: 1, attempt: 1, creditConcept: "grip" });
  assert.equal(same, c);
});

test("amendQuiz caps the credited score at total", () => {
  const c = failedCurriculum();
  c.progress.lastQuiz.score = 3; // already at total (but passed=false contrived)
  const next = amendQuiz(c, { module: 1, attempt: 1, creditConcept: "grip" });
  assert.equal(next.progress.lastQuiz.score, 3);
});
