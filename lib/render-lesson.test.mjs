import { test } from "node:test";
import assert from "node:assert/strict";
import { renderLessonHtml, dirFor, escapeHtml } from "./render-lesson.mjs";

test("dirFor flags RTL languages", () => {
  assert.equal(dirFor("he"), "rtl");
  assert.equal(dirFor("ar"), "rtl");
  assert.equal(dirFor("en"), "ltr");
  assert.equal(dirFor("es-ES"), "ltr");
});

test("escapeHtml neutralizes markup", () => {
  assert.equal(escapeHtml('<script>"&'), "&lt;script&gt;&quot;&amp;");
});

const curriculum = {
  subject: "Espresso",
  settings: { languageCode: "he", passThreshold: 0.7 },
};
const lesson = {
  moduleId: 2,
  attempt: 1,
  title: "מיצוי",
  intro: "מבוא קצר",
  keyIdea: "הרעיון המרכזי",
  sections: [{ heading: "כותרת", paragraphs: ["פסקה"], bullets: ["נקודה"] }],
  drills: [{ prompt: "תרגול ראשון", solution: "הפתרון" }],
  takeaways: ["סיכום"],
  media: { imageUrl: "https://example.com/a.png", imageAlt: "alt", linkUrl: "https://youtu.be/x", linkLabel: "צפו" },
  quiz: [
    { question: "ש1", options: ["a", "b", "c"], correctIndex: 1 },
    { question: "ש2", options: ["a", "b"], correctIndex: 0 },
  ],
};

test("renders an RTL document with lang set", () => {
  const html = renderLessonHtml({ curriculum, lesson, webhookUrl: "https://hook.example/q" });
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.match(html, /<title>מיצוי<\/title>/);
});

test("renders drills as a practice section with a reveal-able solution", () => {
  const html = renderLessonHtml({ curriculum, lesson, webhookUrl: "" });
  assert.match(html, /class="drills"/);
  assert.match(html, /תרגול ראשון/);            // the drill prompt
  assert.match(html, /<details class="drill-sol">/); // solution hidden behind a reveal
  assert.match(html, /הצג פתרון/);              // the he "Show solution" label
  assert.match(html, /הפתרון/);                 // the solution body
});

test("omits the practice section when there are no drills", () => {
  const html = renderLessonHtml({ curriculum, lesson: { ...lesson, drills: [] }, webhookUrl: "" });
  assert.doesNotMatch(html, /class="drills"/);
});

test("embeds remote media as links, not inlined bytes", () => {
  const html = renderLessonHtml({ curriculum, lesson, webhookUrl: "" });
  assert.match(html, /<img src="https:\/\/example.com\/a.png"/);
  assert.match(html, /href="https:\/\/youtu.be\/x"/);
});

test("drops media when the URL is not http(s)", () => {
  const bad = { ...lesson, media: { imageUrl: "javascript:alert(1)", linkUrl: "ftp://x" } };
  const html = renderLessonHtml({ curriculum, lesson: bad, webhookUrl: "" });
  assert.doesNotMatch(html, /javascript:alert/);
  assert.doesNotMatch(html, /ftp:\/\//);
});

test("carries quiz answer key + webhook into the embedded meta", () => {
  const html = renderLessonHtml({ curriculum, lesson, webhookUrl: "https://hook.example/q" });
  assert.match(html, /"correct":\[1,0\]/);
  assert.match(html, /"webhook":"https:\/\/hook.example\/q"/);
  assert.match(html, /"module":2/);
});

test("lesson quiz carries courseId + type into the embedded meta/post", () => {
  const html = renderLessonHtml({ curriculum, lesson, webhookUrl: "https://app/submit", courseId: "abc123xyz789" });
  assert.match(html, /abc123xyz789/);
  assert.match(html, /"quiz"/);
});
