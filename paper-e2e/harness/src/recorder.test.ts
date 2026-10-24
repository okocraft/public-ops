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

describe("Recorder report columns", () => {
  it("renders executed and expected, or a dash", () => {
    const recorder = new Recorder();
    recorder.check("A", "a", true, "seen", [], { executed: "kill A", expected: "1 message" });
    recorder.check("B", "b", true, "seen");
    const [, , first, second] = recorder.toMarkdown().split("\n");
    assert.match(first ?? "", /\| kill A \| 1 message \| seen \|/);
    assert.match(second ?? "", /\| - \| - \| seen \|/);
  });
});
