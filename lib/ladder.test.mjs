import { test } from "node:test";
import assert from "node:assert/strict";
import { modulesPerLevel, buildLadder } from "./ladder.mjs";

test("modulesPerLevel scales with chunk size", () => {
  assert.equal(modulesPerLevel(5), 4);
  assert.equal(modulesPerLevel(10), 3);
  assert.equal(modulesPerLevel(30), 2);
});

test("buildLadder: a band is (per-1) flat modules then a checkpoint", () => {
  // level 9 → 10, 5-min (per=4): three at 9, one checkpoint at 10
  assert.deepEqual(buildLadder(9, 5), [9, 9, 9, 10]);
});

test("buildLadder: full climb length = (10 - startLevel) * per", () => {
  const ladder = buildLadder(7, 5); // 3 levels * 4
  assert.equal(ladder.length, 12);
  assert.deepEqual(ladder, [7, 7, 7, 8, 8, 8, 8, 9, 9, 9, 9, 10]);
});

test("buildLadder: 30-min chunks climb faster (2 per level)", () => {
  assert.deepEqual(buildLadder(8, 30), [8, 9, 9, 10]);
});

test("buildLadder: already at 10 yields a single capstone", () => {
  assert.deepEqual(buildLadder(10, 5), [10]);
});

test("only the checkpoint of each band raises the level", () => {
  // simulate: starting level 7, passing modules in order
  const ladder = buildLadder(7, 5);
  let level = 7;
  const reached = ladder.map((t) => (level = Math.max(level, t)));
  // level should stay 7 through the first 3, hit 8 on the 4th, etc.
  assert.deepEqual(reached, [7, 7, 7, 8, 8, 8, 8, 9, 9, 9, 9, 10]);
});
