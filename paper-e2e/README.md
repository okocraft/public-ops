# Paper E2E

Reusable pieces for end-to-end tests of Paper plugins that use a **real Paper server** and **real
Minecraft protocol clients** (mineflayer bots, no Minecraft account needed).

| Directory | Purpose |
| --- | --- |
| [`harness/`](harness) | TypeScript harness: server lifecycle, bots, scenario runner, evidence-based reporting |
| [`helper-plugin/`](helper-plugin) | Test-only Paper plugin that exposes console commands (`e2epos`, `e2espawn`, `e2eequip`, `e2eperm`, `e2elisten`, ...) and logs structured `E2E <TAG> key=value` lines |

How to plan and run tests with them (stages, evidence rules, reporting) is described in the
[OKOCRAFT docs](https://github.com/okocraft/docs): the *Minecraft / Paper End-to-End Testing* skill and
guideline.

## Safety

The test server runs with `online-mode=false`. The harness refuses to start it unless `server-ip` is a
loopback address. Never expose such a server, and never install the helper plugin on a production server.

## Quick start

Requirements: Node.js 24+, pnpm, a Java runtime that matches the Minecraft version, and Gradle (via the
wrapper) to build the helper plugin.

```sh
cd paper-e2e/helper-plugin && ./gradlew build        # build/libs/E2EHelper-*.jar

cd ../harness
pnpm install
pnpm run check                                         # oxfmt, oxlint, tsc, node --test

# Download Paper (and ViaVersion/ViaBackwards when mineflayer lacks the version) into .e2e/server
NODE_USE_ENV_PROXY=1 node src/cli.ts prepare --dir .e2e/server --minecraft 26.3
cp ../helper-plugin/build/libs/E2EHelper-*.jar .e2e/server/plugins/
# copy the plugin under test (and its dependencies) into .e2e/server/plugins as well

# Optional: a real permission plugin (LuckPerms) for permission checks
NODE_USE_ENV_PROXY=1 node src/cli.ts prepare --dir .e2e/server --minecraft 26.3 --plugin luckperms

node src/cli.ts run --dir .e2e/server --minecraft 26.3 --java /path/to/java examples/death-broadcast.scenario.ts
```

Scenarios change permissions with `env.permission(player, node, "true" | "false" | "unset")`, which runs
`lp user <player> permission ...` (requires `--plugin luckperms`).

`run` writes `report.md` and `results.json` to `.e2e/report` and exits non-zero when a check fails.
`NODE_USE_ENV_PROXY=1` is only needed behind an HTTP proxy (it makes Node's `fetch` honour `HTTPS_PROXY`).
