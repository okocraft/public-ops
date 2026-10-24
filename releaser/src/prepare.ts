/**
 * Verifies and builds the project in the current directory for a release, then copies
 * the binaries to attach into `--out-dir` and writes the release tag to `GITHUB_OUTPUT`.
 *
 * Usage: node prepare.ts --version <version> --out-dir <dir> [--tag <tag>]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { selectAssets } from "./assets.ts";
import { type Command, detectBuildTool } from "./build-tool.ts";
import { resolveTag } from "./tag.ts";
import { assertReleaseVersion } from "./version.ts";

function run(command: Command): string {
  return execFileSync(command.file, command.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function listRemoteTags(): string[] {
  return run({ file: "git", args: ["ls-remote", "--tags", "--refs", "origin"] })
    .split("\n")
    .flatMap((line) => {
      const ref = line.split("\t")[1];
      return ref === undefined ? [] : [ref.replace(/^refs\/tags\//, "")];
    });
}

const { values } = parseArgs({
  options: {
    version: { type: "string" },
    tag: { type: "string" },
    "out-dir": { type: "string" },
  },
  strict: true,
});
const { version, tag: tagOverride, "out-dir": outDir } = values;
if (version === undefined || outDir === undefined) {
  throw new Error("--version and --out-dir are required");
}
assertReleaseVersion(version);

const tool = detectBuildTool(".");
console.log(`Build tool: ${tool.name}`);

const projectVersion = tool.parseVersion(run(tool.version));
if (projectVersion !== version) {
  throw new Error(`Project version is ${projectVersion}, but ${version} was requested`);
}

const primaryJar = tool.finalName === undefined ? undefined : `${run(tool.finalName).trim()}.jar`;

const tag = resolveTag(version, listRemoteTags(), tagOverride === "" ? undefined : tagOverride);
console.log(`Tag: ${tag}`);

execFileSync(tool.build.file, tool.build.args, { stdio: "inherit" });

const assets = selectAssets(readdirSync(tool.outputDir), primaryJar);
mkdirSync(outDir, { recursive: true });
for (const asset of assets) {
  copyFileSync(join(tool.outputDir, asset), join(outDir, asset));
  console.log(`Asset: ${asset}`);
}

if (process.env["GITHUB_OUTPUT"] !== undefined) {
  appendFileSync(process.env["GITHUB_OUTPUT"], `tag=${tag}\n`);
}
