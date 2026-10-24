import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chooseClientVersion } from "./bot.ts";
import { downloadHangarPlugin, downloadLuckPerms, downloadPaper } from "./download.ts";
import { runScenarios } from "./runner.ts";
import type { Scenario } from "./scenario.ts";

const USAGE = `Usage:
  node src/cli.ts prepare --dir <server-dir> --minecraft <version> [--translate] [--plugin luckperms]...
  node src/cli.ts run --dir <server-dir> --minecraft <version> [--java <path>] [--out <dir>] [--reset <path>]... [--only <id>]... [--parallel <n>] [--base-port <port>] [--no-cds] <scenario.ts>...

--reset <path> (relative to <server-dir>, repeatable) is deleted before every scenario, in addition to the
worlds. Use it for plugin data and for files such as ops.json, usercache.json or plugins/LuckPerms/*.
--only <id> (repeatable) runs just those scenarios, for re-running after a fix.
--parallel <n> runs up to n scenarios at the same time, each on its own server copy and port
(base-port + worker number). Every scenario still gets a fresh server.
--no-cds skips the class-data-sharing archive (<server-dir>/.e2e/app.jsa) that is created on the first
run and shortens every server start.
Each scenario's console log is saved to <out>/logs/<scenario id>.log.

Behind a proxy, run with NODE_USE_ENV_PROXY=1 so that downloads use HTTPS_PROXY.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: "string" },
    minecraft: { type: "string" },
    translate: { type: "boolean", default: false },
    plugin: { type: "string", multiple: true, default: [] },
    java: { type: "string", default: "java" },
    out: { type: "string", default: ".e2e/report" },
    reset: { type: "string", multiple: true, default: [] },
    only: { type: "string", multiple: true, default: [] },
    parallel: { type: "string", default: "1" },
    "base-port": { type: "string", default: "25565" },
    "no-cds": { type: "boolean", default: false },
  },
});

const [command, ...files] = positionals;
if (values.dir === undefined || values.minecraft === undefined || command === undefined) {
  console.error(USAGE);
  process.exit(2);
}
const dir = resolve(values.dir);

if (command === "prepare") {
  const paper = await downloadPaper(values.minecraft, dir);
  console.log(`Paper ${paper.version} build ${paper.build} -> ${paper.file}`);
  const client = chooseClientVersion(values.minecraft);
  if (client.needsTranslation || values.translate) {
    for (const slug of ["ViaVersion", "ViaBackwards"]) {
      console.log(`${slug} -> ${await downloadHangarPlugin(slug, dir)}`);
    }
    console.log(
      `mineflayer cannot speak ${values.minecraft}; bots connect as ${client.version} through ViaVersion.`,
    );
  }
  for (const plugin of values.plugin) {
    if (plugin !== "luckperms") {
      throw new Error(`Unknown --plugin ${plugin}. Supported: luckperms`);
    }
    console.log(`LuckPerms -> ${await downloadLuckPerms(dir)}`);
  }
  console.log("Copy the plugin under test and the E2E helper plugin into <server-dir>/plugins.");
} else if (command === "run") {
  const client = chooseClientVersion(values.minecraft);
  const plugins = existsSync(resolve(dir, "plugins")) ? readdirSync(resolve(dir, "plugins")) : [];
  if (
    client.needsTranslation &&
    !(
      plugins.some((f) => f.startsWith("ViaVersion")) &&
      plugins.some((f) => f.startsWith("ViaBackwards"))
    )
  ) {
    throw new Error(
      "ViaVersion and ViaBackwards are required for this Minecraft version. Run `prepare` first.",
    );
  }
  const scenarios: Scenario[] = [];
  for (const file of files) {
    const loaded = (await import(resolve(file))) as { default: Scenario | readonly Scenario[] };
    scenarios.push(
      ...(Array.isArray(loaded.default) ? loaded.default : [loaded.default as Scenario]),
    );
  }
  const selected =
    values.only.length === 0 ? scenarios : scenarios.filter((s) => values.only.includes(s.id));
  const unknown = values.only.filter((id) => !scenarios.some((s) => s.id === id));
  if (unknown.length > 0 || selected.length === 0) {
    throw new Error(
      `No scenario matches --only ${unknown.join(", ")}. Known: ${scenarios.map((s) => s.id).join(", ")}`,
    );
  }
  const recorder = await runScenarios(selected, {
    parallel: Number(values.parallel),
    basePort: Number(values["base-port"]),
    cds: !values["no-cds"],
    env: {
      server: { dir, java: values.java },
      clientVersion: client.version,
      resetPaths: values.reset,
    },
    logDir: resolve(values.out, "logs"),
  });
  const header = [
    `Minecraft/Paper server: ${values.minecraft}`,
    `Client protocol: ${client.version}${client.needsTranslation ? " (translated by ViaVersion/ViaBackwards: client-side display may differ from a native client)" : " (native)"}`,
    "",
  ].join("\n");
  mkdirSync(resolve(values.out), { recursive: true });
  writeFileSync(resolve(values.out, "report.md"), `${header}${recorder.toMarkdown()}\n`);
  writeFileSync(resolve(values.out, "results.json"), JSON.stringify(recorder.results, null, 2));
  console.log(`${header}${recorder.toMarkdown()}`);
  process.exit(recorder.summary().FAIL > 0 ? 1 : 0);
} else {
  console.error(USAGE);
  process.exit(2);
}
