import { test } from "node:test";
import assert from "node:assert/strict";
import { DECK_SCHEMA, deckPrompt } from "./deck-model.mjs";

test("DECK_SCHEMA requires slides with heading/point/notes", () => {
  assert.deepEqual(DECK_SCHEMA.required, ["slides"]);
  const item = DECK_SCHEMA.properties.slides.items;
  assert.deepEqual(item.required.sort(), ["heading", "notes", "point"]);
  assert.equal(item.additionalProperties, false);
});
test("deckPrompt grounds in the paper and asks for presenter notes", () => {
  const p = deckPrompt({ paperText: "TITLE: Tariffs\nAbstract...", settings: { language: "English", educationLevel: "graduate" } });
  assert.match(p, /Tariffs/);
  assert.match(p, /presenter notes/i);
});
