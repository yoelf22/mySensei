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

test("renders generated front-matter (title, subtitle, introduction) before the TOC", () => {
  const withFm = {
    ...curriculum,
    syllabus: {
      title: "Mercer and the Myth",
      subtitle: "Reading Wilbur Mercer as a Christ figure",
      introduction: "Mercerism is the empathic faith of the novel.\n\nWe begin with the Passion, then the empathy box.",
    },
  };
  const html = renderSyllabusHtml({ curriculum: withFm });
  assert.match(html, /<h1>Mercer and the Myth<\/h1>/);
  assert.match(html, /Reading Wilbur Mercer as a Christ figure/);
  assert.match(html, /Introduction/);
  assert.match(html, /<section class="intro"><p>Mercerism is the empathic faith[^<]*<\/p><p>We begin with the Passion[^<]*<\/p><\/section>/);
  assert.match(html, /Contents/);
  // front-matter precedes the table of contents
  assert.ok(html.indexOf('class="intro"') < html.indexOf("<ol>"));
});

test("renders a bibliography section when present", () => {
  const withBib = {
    ...curriculum,
    syllabus: {
      title: "T", subtitle: "S", introduction: "I",
      bibliography: [
        { title: "Art and Culture", author: "Clement Greenberg", note: "Foundational modernist essays." },
        { title: "The Triumph of American Painting", author: "Irving Sandler", note: "A history of Abstract Expressionism." },
      ],
    },
  };
  const html = renderSyllabusHtml({ curriculum: withBib });
  assert.match(html, /Bibliography/);
  assert.match(html, /class="bib"/);
  assert.match(html, /Art and Culture/);
  assert.match(html, /Clement Greenberg/);
  // bibliography comes after the table of contents
  assert.ok(html.indexOf("<ol>") < html.indexOf('class="bib"'));
});
