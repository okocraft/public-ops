# Paper E2E

Reusable pieces for end-to-end tests of Paper plugins that use a **real Paper server** and **real
Minecraft protocol clients** (mineflayer bots, no Minecraft account needed).

| Directory | Purpose |
| --- | --- |
| [`harness/`](harness) | TypeScript harness: server lifecycle, bots, scenario runner, evidence-based reporting |
| [`helper-plugin/`](helper-plugin) | Test-only Paper plugin that exposes console commands (`e2epos`, `e2espawn`, `e2eequip`, `e2elisten`, ...) and logs structured `E2E <TAG> key=value` lines |

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

`run` writes `report.md`, `results.json` and one console log per scenario (`logs/<scenario id>.log`) to
`.e2e/report` and exits non-zero when a check fails.
`NODE_USE_ENV_PROXY=1` is only needed behind an HTTP proxy (it makes Node's `fetch` honour `HTTPS_PROXY`).

## Scenario options

- **Clean state**: every scenario starts with fresh worlds. Plugin data and server files are kept unless
  listed with `--reset <path>` (relative to the server directory, repeatable), e.g.
  `--reset plugins/MyPlugin --reset ops.json --reset usercache.json --reset plugins/LuckPerms`.
- **Bots**: `bots` in a scenario (and `env.join`) accept names or `{ username, recordPackets, locale }`.
  `recordPackets` is a regular expression on packet names (the default keeps only death and merchant
  packets, so add e.g. `world_particles|sound_effect` to observe effects); `locale` is the client locale.
- **Sneaking**: `bot.useEntity(entityId, { sneaking: true })` sends the interact packet with an explicit
  sneaking flag. mineflayer's `activateEntity` always sends `sneaking: false`.
- **Report columns**: `recorder.check(id, title, ok, evidence, covers, { executed, expected })` fills the
  report's Executed and Expected columns (`-` when omitted).
- **Known log noise**: `server.errors()` returns `ERROR`/`FATAL` lines without `KNOWN_SERVER_NOISE`
  (for example `No key layers in MapLike[{}]`, which a healthy server prints on every start).

## Speed

Most of a scenario's time is fixed overhead: Paper boots in 13-15 s and the bots need 5-9 s to join, on every fresh server. The harness reduces this in three ways.

- **Faster starts.** `run` creates a class-data-sharing archive once (`<server-dir>/.e2e/app.jsa`, by starting the prepared server and stopping it) and starts every server with it, together with a serial GC and C1-only JIT (`DEFAULT_JVM_ARGS`). A start drops from about 15 s to 10 s. Delete the archive after changing Java or `paper.jar`; `--no-cds` disables it.
- **Parallel scenarios.** `--parallel <n>` runs n scenarios at once, each on its own copy of the server directory (large read-only directories are linked) and its own port (`--base-port` + worker number). Every scenario still gets a fresh server. Use at most one worker per CPU core (a server uses 1 GB by default).
- **Waits for conditions, not for time.** `env.sayUntil(name, text, /pattern/)` returns when the bot received the expected message, `env.helper(...)` returns at the helper's first line, `env.permission(...)` returns at LuckPerms' answer, and `bot.waitFor(predicate)` / `server.runUntil(command, /pattern/)` do the same for your own checks. A check that something does **not** happen still needs a fixed window; keep it short and give it a control.

`--only <id>` (repeatable) runs just the named scenarios, for re-running after a fix instead of the whole set.
