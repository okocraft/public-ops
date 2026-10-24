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

  it("drops the plain Maven JAR when a shaded JAR has its own name", () => {
    assert.deepEqual(selectAssets(["tfly-1.5.jar", "TFly-1.5.jar"], "tfly-1.5.jar"), [
      "TFly-1.5.jar",
    ]);
  });

  it("keeps the Maven primary JAR when it is the only candidate", () => {
    assert.deepEqual(selectAssets(["Hugs-1.4.jar", "original-Hugs-1.4.jar"], "Hugs-1.4.jar"), [
      "Hugs-1.4.jar",
    ]);
  });

  it("fails when several Maven JARs remain", () => {
    assert.throws(() => selectAssets(["a-1.0.jar", "b-1.0.jar", "c-1.0.jar"], "a-1.0.jar"));
  });
});
