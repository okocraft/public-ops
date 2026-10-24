import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseGradleVersion } from "./version.ts";

export interface Command {
  readonly file: string;
  readonly args: readonly string[];
}

export interface BuildTool {
  readonly name: "gradle" | "maven";
  /** Prints the project version; `parseVersion` extracts it from stdout. */
  readonly version: Command;
  readonly parseVersion: (stdout: string) => string;
  readonly build: Command;
  /** Directory, relative to the project, containing the built binaries. */
  readonly outputDir: string;
}

const gradlew = (...args: string[]): Command => ({ file: "sh", args: ["./gradlew", ...args] });

const GRADLE: BuildTool = {
  name: "gradle",
  version: gradlew("properties", "--quiet", "--console=plain", "--no-configuration-cache"),
  parseVersion: parseGradleVersion,
  build: gradlew("build", "--console=plain"),
  outputDir: join("build", "libs"),
};

function maven(projectDir: string): BuildTool {
  const mvn = (...args: string[]): Command =>
    existsSync(join(projectDir, "mvnw"))
      ? { file: "sh", args: ["./mvnw", "--batch-mode", ...args] }
      : { file: "mvn", args: ["--batch-mode", ...args] };
  return {
    name: "maven",
    version: mvn("--quiet", "help:evaluate", "-Dexpression=project.version", "-DforceStdout"),
    parseVersion: (stdout) => stdout.trim(),
    build: mvn("package"),
    outputDir: "target",
  };
}

export function detectBuildTool(projectDir: string): BuildTool {
  const hasGradle = existsSync(join(projectDir, "gradlew"));
  const hasMaven = existsSync(join(projectDir, "pom.xml"));
  if (hasGradle && hasMaven) {
    throw new Error("Found both gradlew and pom.xml; cannot choose a build tool");
  }
  if (hasGradle) {
    return GRADLE;
  }
  if (hasMaven) {
    return maven(projectDir);
  }
  throw new Error("Found neither gradlew nor pom.xml");
}
