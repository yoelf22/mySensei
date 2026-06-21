import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCourseIndexHtml } from "./render-course-index.mjs";

const curriculum = {
  subject: "Melancholy in abstract painting",
  settings: { languageCode: "en" },
  syllabus: { title: "Painting Grief" },
  outline: [
    { id: 1, title: "What Is Abstract Painting?" },
    { id: 2, title: "What Is Melancholy?" },
  ],
  progress: {
    delivered: [
      { module: 1, attempt: 1, lessonFile: "lesson-01-attempt1", sentAt: "2026-06-21T07:00:00.000Z" },
      { module: 2, attempt: 2, lessonFile: "lesson-02-attempt2", sentAt: "2026-06-22T07:00:00.000Z" },
    ],
  },
};

test("lists the syllabus first, then every delivered class in order", () => {
  const html = renderCourseIndexHtml({ curriculum, courseId: "abc123" });
  assert.match(html, /Painting Grief/);                         // title from syllabus front-matter
  assert.match(html, /href="\/c\/abc123\/syllabus"/);           // syllabus link
  assert.match(html, /href="\/c\/abc123\/lesson-01-attempt1"/); // class 1 link
  assert.match(html, /href="\/c\/abc123\/lesson-02-attempt2"/); // class 2 link
  assert.match(html, /What Is Abstract Painting\?/);            // module title from outline
  assert.match(html, /attempt 2/);                              // re-taught attempt shown
  // syllabus link comes before the class list
  assert.ok(html.indexOf('class="syllabus"') < html.indexOf("lesson-01-attempt1"));
});

test("falls back to subject and shows an empty-state when no classes yet", () => {
  const c = { subject: "Taxes", settings: { languageCode: "en" }, outline: [], progress: { delivered: [] } };
  const html = renderCourseIndexHtml({ curriculum: c, courseId: "xyz" });
  assert.match(html, /Taxes/);                  // title falls back to subject
  assert.match(html, /href="\/c\/xyz\/syllabus"/);
  assert.match(html, /No classes have been delivered yet/);
});

test("honors RTL and escapes content", () => {
  const c = { subject: "<x>", settings: { languageCode: "he" }, outline: [], progress: { delivered: [] } };
  const html = renderCourseIndexHtml({ curriculum: c, courseId: "h1" });
  assert.match(html, /dir="rtl"/);
  assert.match(html, /&lt;x&gt;/);
});
