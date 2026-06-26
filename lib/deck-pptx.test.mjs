import { test } from "node:test";
import assert from "node:assert/strict";
import { deckToPptx } from "./deck-pptx.mjs";
test("deckToPptx returns a non-empty buffer", async () => {
  const buf = await deckToPptx({ slides: [{ heading: "Title", point: "One key learning", notes: "Say this aloud." }] });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
});
