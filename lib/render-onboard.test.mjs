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
