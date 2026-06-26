import { test } from "node:test";
import assert from "node:assert/strict";
import { renderOnboardHtml } from "./render-onboard.mjs";

test("renders the onboard form with a webhook hook embedded", () => {
  const html = renderOnboardHtml({ webhookUrl: "https://hook.example/submit" });
  assert.match(html, /<form id="f">/);
  assert.match(html, /https:\/\/hook\.example\/submit/);
  assert.match(html, /"onboard"/);
});

test("embeds the webhookUrl as a JS literal in the script block", () => {
  const html = renderOnboardHtml({ webhookUrl: "https://x.com/submit" });
  assert.match(html, /https:\/\/x\.com\/submit/);
});

test("onboard form carries courseId and type into the POST body", () => {
  const html = renderOnboardHtml({ webhookUrl: "https://app/submit", courseId: "abc123xyz789" });
  assert.match(html, /abc123xyz789/);
  assert.match(html, /"onboard"/);
});

test("onboard form offers an education-level select and carries educationLevel", () => {
  const html = renderOnboardHtml({ webhookUrl: "https://app/submit", courseId: "c1" });
  assert.match(html, /name="educationLevel"/);
  assert.match(html, /value="middle-school"/);
  assert.match(html, /value="graduate"/);
  assert.match(html, /educationLevel: d\.get\("educationLevel"\)/); // posted in the payload
});

test("renderOnboardHtml prefills subject and angle when given", () => {
  const html = renderOnboardHtml({ webhookUrl: "https://app/submit", courseId: "c1", subject: "Chess <openings>", angle: "for clubs" });
  assert.match(html, /Chess &lt;openings&gt;<\/textarea>/);     // subject prefilled + escaped
  assert.match(html, /name="angle"[^>]*value="for clubs"/);     // angle prefilled
});

test("renderOnboardHtml has empty subject/angle by default", () => {
  const html = renderOnboardHtml({ webhookUrl: "https://app/submit", courseId: "c1" });
  assert.match(html, /name="subject" required placeholder="[^"]*"><\/textarea>/); // empty textarea
});

test("renderOnboardHtml has a domain select and sends domain in the payload", () => {
  const html = renderOnboardHtml({ webhookUrl: "https://app/submit", courseId: "c1" });
  assert.match(html, /name="domain"/);
  assert.match(html, /value="engineering"/);
  assert.match(html, /value="arts-humanities"/);
  assert.match(html, /domain:\s*d\.get\("domain"\)/); // payload carries it
});

test("onboard renders a kind toggle with research option", () => {
  const html = renderOnboardHtml({ webhookUrl: "http://h/submit", courseId: "abc" });
  assert.match(html, /name="kind"/);
  assert.match(html, /value="research"/);
  assert.match(html, /value="course"[^>]*checked/);
});

test("payload-building JS includes kind", () => {
  const html = renderOnboardHtml({ webhookUrl: "http://h/submit", courseId: "abc" });
  assert.match(html, /kind:\s*d\.get\("kind"\)/);
});
