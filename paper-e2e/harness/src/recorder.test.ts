import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Recorder } from "./recorder.ts";

describe("Recorder", () => {
  it("counts results by status", () => {
    const recorder = new Recorder();
    recorder.check("A", "a", true, "seen");
    recorder.check("B", "b", false, "not seen");
    recorder.unverified("C", "c", "no client support");
    assert.deepEqual(recorder.summary(), { PASS: 1, FAIL: 1, UNVERIFIED: 1 });
  });

  it("rejects a check without evidence", () => {
    assert.throws(() => new Recorder().check("A", "a", true, "  "));
  });

  it("escapes table separators in the report", () => {
    const recorder = new Recorder();
    recorder.check("A", "a|b", true, "x\ny");
    assert.match(recorder.toMarkdown(), /a\\\|b/);
  });
});
