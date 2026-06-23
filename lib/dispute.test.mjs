import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRuling, rulingEmail, pitfallsDirective } from "./dispute.mjs";

function curriculum() {
  return {
    level: 4,
    settings: { passThreshold: 0.7, language: "English" },
    outline: [{ id: 1, title: "A", targetLevel: 5 }, { id: 2, title: "B", targetLevel: 6 }],
    progress: {
      currentModule: 1,
      attempt: 2,
      lastQuiz: { module: 1, attempt: 1, score: 2, total: 3, passed: false, missedConcepts: ["grip"] },
    },
  };
}

const dispute = {
  module: 1,
  attempt: 1,
  questionIndex: 0,
  payload: { question: "Q?", options: ["a", "b", "c"], correctIndex: 1, chosenIndex: 0, concept: "grip", explanation: "because b", reason: "a is also valid" },
};

test("applyRuling: rejected leaves the curriculum unchanged and logs no correction", () => {
  const c = curriculum();
  const ruling = { verdict: "stands", upheld: false, reasoning: "b is the single best answer", correctedQuestion: dispute.payload };
  const r = applyRuling(c, dispute, ruling, "2026-06-23T00:00:00Z");
  assert.equal(r.curriculum, c);
  assert.equal(r.correction, null);
  assert.equal(r.regraded, false);
  assert.equal(r.passedNow, false);
});

test("applyRuling: upheld credits the quiz (flips to pass) and logs a correction", () => {
  const c = curriculum();
  const ruling = { verdict: "learner_correct", upheld: true, reasoning: "you're right, a works too", correctedQuestion: { question: "Q?", options: ["a", "b", "c"], correctIndex: 0, explanation: "a is correct" } };
  const r = applyRuling(c, dispute, ruling, "2026-06-23T00:00:00Z");
  assert.equal(r.regraded, true);
  assert.equal(r.passedNow, true);
  assert.equal(r.curriculum.progress.lastQuiz.score, 3);
  assert.equal(r.curriculum.progress.currentModule, 2);
  assert.equal(r.curriculum.progress.corrections.length, 1);
  assert.equal(r.curriculum.progress.corrections[0].verdict, "learner_correct");
  assert.equal(r.curriculum.progress.corrections[0].at, "2026-06-23T00:00:00Z");
});

test("applyRuling: upheld but stale still logs the correction without regrading", () => {
  const c = curriculum();
  const stale = { ...dispute, attempt: 99 };
  const ruling = { verdict: "question_flawed", upheld: true, reasoning: "key was wrong", correctedQuestion: dispute.payload };
  const r = applyRuling(c, stale, ruling, "t");
  assert.equal(r.regraded, false);
  assert.equal(r.curriculum.progress.corrections.length, 1);
  assert.notEqual(r.curriculum, c); // cloned so the correction persists
});

test("rulingEmail: upheld mentions the corrected answer; rejected explains it stands", () => {
  const up = rulingEmail(dispute, { verdict: "learner_correct", upheld: true, reasoning: "you're right", correctedQuestion: { question: "Q?", options: ["a", "b", "c"], correctIndex: 0, explanation: "a" } }, { regraded: true, passedNow: true }, "English");
  assert.match(up.subject, /upheld/i);
  assert.match(up.text, /you're right/);
  assert.match(up.html, /<a|<p/);
  const no = rulingEmail(dispute, { verdict: "stands", upheld: false, reasoning: "b is best", correctedQuestion: dispute.payload }, { regraded: false, passedNow: false }, "English");
  assert.match(no.text, /b is best/);
});

test("pitfallsDirective: empty without corrections, lists them when present", () => {
  assert.equal(pitfallsDirective(curriculum()), "");
  const c = curriculum();
  c.progress.corrections = [{ original: { question: "bad Q" }, verdict: "question_flawed" }];
  assert.match(pitfallsDirective(c), /bad Q/);
});
