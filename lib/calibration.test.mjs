import { test } from "node:test";
import assert from "node:assert/strict";
import { levelBandLabel, adjustLevel, domainLabel, DOMAINS } from "./calibration.mjs";

test("levelBandLabel maps levels to band labels and clamps", () => {
  assert.equal(levelBandLabel(1), "General audience");
  assert.equal(levelBandLabel(4), "Undergraduate (intro)");
  assert.equal(levelBandLabel(6), "Undergraduate (advanced)");
  assert.equal(levelBandLabel(8), "Graduate");
  assert.equal(levelBandLabel(10), "Expert / research");
  assert.equal(levelBandLabel(0), "General audience");
  assert.equal(levelBandLabel(99), "Expert / research");
});

test("adjustLevel moves one band and clamps at both ends", () => {
  assert.equal(adjustLevel(5, "up"), 8);    // band 2 → band 3
  assert.equal(adjustLevel(5, "down"), 4);  // band 2 → band 1
  assert.equal(adjustLevel(2, "down"), 2);  // already lowest
  assert.equal(adjustLevel(10, "up"), 10);  // already highest
  assert.equal(levelBandLabel(adjustLevel(6, "up")), "Graduate");
});

test("domainLabel resolves a known slug and falls back to Other", () => {
  assert.equal(domainLabel("engineering"), DOMAINS.find((d) => d.slug === "engineering").label);
  assert.equal(domainLabel("nonsense"), "Other");
  assert.equal(domainLabel(undefined), "Other");
});
