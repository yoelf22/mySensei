import { test } from "node:test";
import assert from "node:assert/strict";
import { paperToDocx } from "./paper-docx.mjs";
test("paperToDocx returns a non-empty buffer", async () => {
  const buf = await paperToDocx(
    { title: "T", subtitle: "S", abstract: "A", sections: [{ heading: "H", body: "B1\n\nB2" }], conclusion: "C" },
    [{ title: "Src", url: "http://s" }],
  );
  assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
});
