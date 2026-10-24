import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sleep, stripAnsi } from "./text.ts";

/** Server processes to kill when the harness exits, so no server outlives a crashed run. */
const runningProcesses = new Set<ChildProcessWithoutNullStreams>();
process.on("exit", () => {
  for (const child of runningProcesses) {
    child.kill("SIGKILL");
  }
});

const LOOPBACK_ADDRESSES: ReadonlySet<string> = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * `server.properties` for an unauthenticated test server. `online-mode=false` is only allowed
 * together with a loopback `server-ip`, so the server is never reachable from outside.
 */
export function serverProperties(overrides: Record<string, string> = {}): string {
  const properties: Record<string, string> = {
    "online-mode": "false",
    "server-ip": "127.0.0.1",
    "server-port": "25565",
    "white-list": "false",
    "enforce-secure-profile": "false",
    "level-type": "minecraft:flat",
    "level-seed": "0",
    "generate-structures": "false",
    "spawn-protection": "0",
    "view-distance": "4",
    "simulation-distance": "4",
    difficulty: "peaceful",
    gamemode: "survival",
    "spawn-monsters": "false",
    "enable-rcon": "false",
    "enable-query": "false",
    "max-players": "20",
    motd: "e2e",
    ...overrides,
  };
  if (
    properties["online-mode"] === "false" &&
    !LOOPBACK_ADDRESSES.has(properties["server-ip"] ?? "")
  ) {
    throw new Error("online-mode=false requires a loopback server-ip. Refusing to expose it.");
  }
  return Object.entries(properties)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

/**
 * Server log lines that look like errors but appear on every start of a healthy server.
 * {@link PaperServer.errors} skips them so that an error scan does not report them.
 */
export const KNOWN_SERVER_NOISE: readonly RegExp[] = [/No key layers in MapLike\[\{\}\]/];

/**
 * JVM flags that shorten the start of a short-lived test server: a serial GC and the C1 compiler
 * only (the server lives for seconds, so optimizing compilation does not pay off).
 */
export const DEFAULT_JVM_ARGS: readonly string[] = ["-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1"];

export interface PaperServerOptions {
  /** Working directory of the server. Contains `paper.jar` unless `jar` is given. */
  readonly dir: string;
  /** Jar to run; a relative path is resolved against `dir`. */
  readonly jar?: string;
  readonly java?: string;
  readonly memory?: string;
  /** JVM flags placed before `-jar`. Defaults to {@link DEFAULT_JVM_ARGS}. */
  readonly jvmArgs?: readonly string[];
  readonly properties?: Record<string, string>;
}

/** A Paper server process driven through its console. */
export class PaperServer {
  readonly dir: string;
  readonly lines: string[] = [];
  readonly #options: PaperServerOptions;
  #process: ChildProcessWithoutNullStreams | null = null;
  #exited: Promise<number | null> = Promise.resolve(0);

  constructor(options: PaperServerOptions) {
    this.dir = options.dir;
    this.#options = options;
  }

  /** Deletes world and plugin data so that a run starts from a known state. */
  reset(extraPaths: readonly string[] = []): void {
    for (const path of ["world", "world_nether", "world_the_end", "logs", ...extraPaths]) {
      rmSync(join(this.dir, path), { recursive: true, force: true });
    }
    rmSync(this.#logFile, { force: true });
  }

  /** Writes files (path relative to the server directory), creating folders as needed. */
  writeFiles(files: Readonly<Record<string, string>>): void {
    for (const [path, content] of Object.entries(files)) {
      const target = join(this.dir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
  }

  async start(timeoutMs = 180_000): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, "eula.txt"), "eula=true\n");
    writeFileSync(join(this.dir, "server.properties"), serverProperties(this.#options.properties));
    // `lines` survives a restart; match only the `Done` of this start, not one from a previous run.
    const startMark = this.mark();
    const java = this.#options.java ?? "java";
    const child = spawn(
      java,
      [
        ...(this.#options.jvmArgs ?? DEFAULT_JVM_ARGS),
        `-Xmx${this.#options.memory ?? "1G"}`,
        "-jar",
        this.#options.jar ?? "paper.jar",
        "--nogui",
      ],
      { cwd: this.dir },
    );
    this.#process = child;
    const onData = (chunk: Buffer): void => {
      for (const raw of chunk.toString().split("\n")) {
        const line = stripAnsi(raw).trimEnd();
        if (line === "" || line.includes("Picked up JAVA_TOOL_OPTIONS")) {
          continue;
        }
        this.lines.push(line);
        appendFileSync(this.#logFile, `${line}\n`);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    this.#exited = new Promise((resolve) =>
      child.on("exit", (code) => {
        runningProcesses.delete(child);
        resolve(code);
      }),
    );
    runningProcesses.add(child);
    await this.waitForLog(/Done \(/, timeoutMs, startMark);
  }

  /** Sends a console command. The command is also written to the run log for traceability. */
  command(command: string): void {
    appendFileSync(this.#logFile, `>>> ${command}\n`);
    this.#require().stdin.write(`${command}\n`);
  }

  /** Runs a console command and returns the log lines produced within `waitMs`. */
  async run(command: string, waitMs = 600): Promise<string[]> {
    const mark = this.mark();
    this.command(command);
    await sleep(waitMs);
    return this.since(mark);
  }

  /** `ERROR` / `FATAL` log lines (after `from`) that are not {@link KNOWN_SERVER_NOISE}. */
  errors(from = 0): string[] {
    return this.lines
      .slice(from)
      .filter((line) => /\b(ERROR|FATAL)\b/.test(line))
      .filter((line) => !KNOWN_SERVER_NOISE.some((noise) => noise.test(line)));
  }

  /**
   * Runs a console command and returns as soon as a log line matches `pattern` (plus `settleMs`
   * for the lines that follow it), or after `timeoutMs` when nothing matched. The caller checks the
   * returned lines; a missing line is an observation, not an exception.
   */
  async runUntil(
    command: string,
    pattern: RegExp,
    timeoutMs = 3000,
    settleMs = 100,
  ): Promise<string[]> {
    const mark = this.mark();
    this.command(command);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.since(mark).some((line) => pattern.test(line))) {
        await sleep(settleMs);
        break;
      }
      await sleep(25);
    }
    return this.since(mark);
  }

  mark(): number {
    return this.lines.length;
  }

  since(mark: number): string[] {
    return this.lines.slice(mark);
  }

  /** Resolves with the first log line (after `from`) matching `pattern`, or rejects on timeout. */
  async waitForLog(
    pattern: RegExp,
    timeoutMs: number,
    from: number = this.mark(),
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.lines.slice(from).find((line) => pattern.test(line));
      if (found !== undefined) {
        return found;
      }
      await sleep(250);
    }
    throw new Error(`Timed out waiting for log line ${pattern}`);
  }

  /** Stops the server gracefully, which also flushes plugin data to disk. */
  async stop(): Promise<void> {
    this.command("stop");
    await this.#exited;
    this.#process = null;
  }

  get #logFile(): string {
    return join(this.dir, "e2e-console.log");
  }

  #require(): ChildProcessWithoutNullStreams {
    if (this.#process === null) {
      throw new Error("The server is not running.");
    }
    return this.#process;
  }
}
