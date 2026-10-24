import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertReleaseVersion, parseGradleVersion } from "./version.ts";

describe("assertReleaseVersion", () => {
  it("accepts release versions", () => {
    for (const version of ["1.4", "0.1.0", "6.0.0-rc.4", "1.1.0-pre1"]) {
      assert.doesNotThrow(() => assertReleaseVersion(version), version);
    }
  });

  it("rejects snapshots and malformed versions", () => {
    for (const version of ["1", "v1.0", "1.0-SNAPSHOT", "1.0.0-snapshot.1", "1.0 ", "1.0;rm"]) {
      assert.throws(() => assertReleaseVersion(version), version);
    }
  });
});

describe("parseGradleVersion", () => {
  it("reads the version line", () => {
    assert.equal(parseGradleVersion("name: Yaminabe\nversion: 0.1.0\n"), "0.1.0");
  });

  it("fails without a version line", () => {
    assert.throws(() => parseGradleVersion("name: Yaminabe\n"));
  });
});
