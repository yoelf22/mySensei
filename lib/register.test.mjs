import { test } from "node:test";
import assert from "node:assert/strict";
import { registerDirective } from "./register.mjs";

test("maps each education tier to a distinct directive", () => {
  assert.match(registerDirective("middle-school"), /middle-school/i);
  assert.match(registerDirective("high-school"), /high-school/i);
  assert.match(registerDirective("undergraduate"), /undergraduate/i);
  assert.match(registerDirective("graduate"), /field fluency/i);
});

test("defaults to the undergraduate register for unknown/missing input", () => {
  const u = registerDirective("undergraduate");
  assert.equal(registerDirective("bogus"), u);
  assert.equal(registerDirective(""), u);
  assert.equal(registerDirective(undefined), u);
  assert.equal(registerDirective(null), u);
});

test("is case-insensitive", () => {
  assert.equal(registerDirective("Graduate"), registerDirective("graduate"));
});
