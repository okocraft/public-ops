import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTag } from "./tag.ts";

describe("resolveTag", () => {
  it("follows v-prefixed tags", () => {
    assert.equal(resolveTag("6.0.0", ["v3.1.5", "v3.1.6"]), "v6.0.0");
  });

  it("follows bare tags", () => {
    assert.equal(resolveTag("1.5", ["1.3", "1.4"]), "1.5");
  });

  it("defaults to the v prefix without tags", () => {
    assert.equal(resolveTag("0.1.0", []), "v0.1.0");
  });

  it("ignores tags that are not versions", () => {
    assert.equal(resolveTag("1.0", ["latest", "1.0-beta"]), "1.0");
  });

  it("fails on mixed styles unless overridden", () => {
    assert.throws(() => resolveTag("2.0", ["v1.0", "1.1"]));
    assert.equal(resolveTag("2.0", ["v1.0", "1.1"], "v2.0"), "v2.0");
  });

  it("fails when the tag exists", () => {
    assert.throws(() => resolveTag("1.4", ["1.4"]));
  });

  it("rejects invalid overrides", () => {
    assert.throws(() => resolveTag("1.0", [], "-v1.0"));
    assert.throws(() => resolveTag("1.0", [], "v1.0 x"));
  });
});
