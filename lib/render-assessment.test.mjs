import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAssessmentHtml } from "./render-assessment.mjs";

const questions = [
  { question: "What is espresso?", level: 1, options: ["Coffee", "Tea", "Juice"], correctIndex: 0 },
  { question: "How hot?", level: 2, options: ["Cold", "Hot", "Warm"], correctIndex: 1 },
];

test("renders placement check questions with radio options", () => {
  const html = renderAssessmentHtml({ questions, webhookUrl: "https://hook.example/submit", languageCode: "en", subject: "Espresso" });
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.match(html, /placement check/);
  assert.match(html, /What is espresso\?/);
  assert.match(html, /How hot\?/);
  assert.match(html, /"assessment"/);
});

test("honors RTL language", () => {
  const html = renderAssessmentHtml({ questions: [], webhookUrl: "", languageCode: "he", subject: "S" });
  assert.match(html, /dir="rtl"/);
});

test("assessment carries courseId + type", () => {
  const html = renderAssessmentHtml({ questions: [{ prompt: "q", options: ["a"], answerLevel: 3 }], webhookUrl: "https://app/submit", courseId: "abc123xyz789", languageCode: "en", subject: "S" });
  assert.match(html, /abc123xyz789/);
  assert.match(html, /"assessment"/);
});
