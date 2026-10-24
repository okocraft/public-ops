import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { detectBuildTool } from "./build-tool.ts";

function project(...files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "releaser-"));
  for (const file of files) {
    writeFileSync(join(dir, file), "");
  }
  return dir;
}

describe("detectBuildTool", () => {
  it("detects Gradle by its wrapper", () => {
    const tool = detectBuildTool(project("gradlew", "settings.gradle.kts"));
    assert.equal(tool.name, "gradle");
    assert.equal(tool.outputDir, join("build", "libs"));
  });

  it("detects Maven and prefers its wrapper", () => {
    assert.equal(detectBuildTool(project("pom.xml")).build.file, "mvn");
    assert.deepEqual(detectBuildTool(project("pom.xml", "mvnw")).build.args.slice(0, 1), [
      "./mvnw",
    ]);
  });

  it("fails on both or neither", () => {
    assert.throws(() => detectBuildTool(project("gradlew", "pom.xml")));
    assert.throws(() => detectBuildTool(project()));
  });
});
