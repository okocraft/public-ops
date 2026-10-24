import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sleep, stripAnsi } from "./text.ts";

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

export interface PaperServerOptions {
  /** Directory containing `paper.jar` (or the jar named by `jar`). */
  readonly dir: string;
  readonly jar?: string;
  readonly java?: string;
  readonly memory?: string;
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

  async start(timeoutMs = 180_000): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, "eula.txt"), "eula=true\n");
    writeFileSync(join(this.dir, "server.properties"), serverProperties(this.#options.properties));
    const java = this.#options.java ?? "java";
    const child = spawn(
      java,
      [`-Xmx${this.#options.memory ?? "1G"}`, "-jar", this.#options.jar ?? "paper.jar", "--nogui"],
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
    this.#exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
    process.on("exit", () => child.kill("SIGKILL"));
    await this.waitForLog(/Done \(/, timeoutMs, 0);
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
