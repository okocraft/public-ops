import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectAssets } from "./assets.ts";

describe("selectAssets", () => {
  it("keeps distributable JARs", () => {
    assert.deepEqual(selectAssets(["Yaminabe-Velocity-0.1.0.jar", "Yaminabe-Paper-0.1.0.jar"]), [
      "Yaminabe-Paper-0.1.0.jar",
      "Yaminabe-Velocity-0.1.0.jar",
    ]);
  });

  it("excludes shade originals, classifiers and non-JAR files", () => {
    assert.deepEqual(
      selectAssets([
        "TFly-1.5.jar",
        "original-TFly-1.5.jar",
        "TFly-1.5-sources.jar",
        "TFly-1.5-javadoc.jar",
        "TFly-1.5-tests.jar",
        "classes",
        "maven-archiver",
      ]),
      ["TFly-1.5.jar"],
    );
  });

  it("fails when nothing is left", () => {
    assert.throws(() => selectAssets(["original-Hugs-1.4.jar", "classes"]));
  });
});
