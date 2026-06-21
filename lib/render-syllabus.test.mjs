import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSyllabusHtml } from "./render-syllabus.mjs";

const curriculum = {
  subject: "Mercerism as Christ myth",
  angle: "Wilbur Mercer as a Christ figure",
  startLevel: 7,
  level: 7,
  settings: { languageCode: "en", cadence: "daily", deliveryTime: "07:00", timezone: "Asia/Jerusalem" },
  outline: [
    { id: 1, title: "The Passion", summary: "The climb and the rising.", targetLevel: 8 },
    { id: 2, title: "The empathy box", summary: "Communion and stigmata.", targetLevel: 9 },
  ],
};

test("renders a standalone syllabus with title, modules, and schedule", () => {
  const html = renderSyllabusHtml({ curriculum });
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.match(html, /Course syllabus/);
  assert.match(html, /The Passion/);
  assert.match(html, /The empathy box/);
  assert.match(html, /→ to level 8/);
  assert.match(html, /Lessons arrive every day at 07:00/);
  assert.match(html, /7 → 10 · 2 modules/);
  // no quiz in a syllabus
  assert.doesNotMatch(html, /<fieldset/);
  assert.doesNotMatch(html, /<script/);
});

test("escapes content and honors RTL", () => {
  const rtl = { ...curriculum, settings: { ...curriculum.settings, languageCode: "he" }, subject: "<x>" };
  const html = renderSyllabusHtml({ curriculum: rtl });
  assert.match(html, /dir="rtl"/);
  assert.match(html, /&lt;x&gt;/);
});

test("syllabus approve carries courseId", () => {
  const curriculum = { subject: "S", angle: "a", level: 3, settings: { languageCode: "en" }, outline: [{ id: 1, title: "M1", summary: "s", targetLevel: 4 }] };
  const html = renderSyllabusHtml({ curriculum, webhookUrl: "https://app/submit", courseId: "abc123xyz789" });
  assert.match(html, /abc123xyz789/);
  assert.match(html, /"approve"/);
});
