import { TestBot, type BotSpec } from "./bot.ts";
import { parseHelperLine, toPosition, type HelperLine, type PlayerPosition } from "./helper-log.ts";
import { PaperServer, type PaperServerOptions } from "./paper.ts";
import { sleep } from "./text.ts";

export interface E2eEnvOptions {
  readonly server: PaperServerOptions;
  /** Client version for bots; see `chooseClientVersion`. */
  readonly clientVersion: string;
  /** Extra paths (relative to the server directory) to delete when starting from a clean state. */
  readonly resetPaths?: readonly string[];
  /** Packet names (regular expression) recorded for bots that do not set their own `recordPackets`. */
  readonly recordPackets?: RegExp;
  /** Port of this server and its bots (default 25565). Parallel workers use different ports. */
  readonly port?: number;
}

/** A running test server plus the bots connected to it. */
export class E2eEnv {
  readonly server: PaperServer;
  readonly bots: Record<string, TestBot> = {};
  readonly #options: E2eEnvOptions;

  constructor(options: E2eEnvOptions) {
    this.#options = options;
    this.server = new PaperServer({
      ...options.server,
      properties: { ...options.server.properties, "server-port": String(options.port ?? 25565) },
    });
  }

  /** Starts the server. With `fresh`, worlds and `resetPaths` are deleted first. */
  async start(
    options: {
      fresh?: boolean;
      setupCommands?: readonly string[];
      /** Files to write (path relative to the server directory) before the server starts. */
      files?: Readonly<Record<string, string>>;
    } = {},
  ): Promise<void> {
    if (options.fresh ?? true) {
      this.server.reset(this.#options.resetPaths);
    }
    this.server.writeFiles(options.files ?? {});
    await this.server.start();
    for (const command of options.setupCommands ?? []) {
      this.server.command(command);
      await sleep(300);
    }
  }

  /** Connects bots. A bare name uses the defaults; an object sets per-bot options. */
  async join(...specs: BotSpec[]): Promise<void> {
    for (const spec of specs) {
      const options = typeof spec === "string" ? { username: spec } : spec;
      const defaults =
        this.#options.recordPackets === undefined
          ? {}
          : { recordPackets: this.#options.recordPackets };
      const bot = new TestBot({
        ...defaults,
        ...options,
        version: this.#options.clientVersion,
        port: this.#options.port ?? 25565,
      });
      await bot.join();
      this.bots[options.username] = bot;
    }
    await sleep(2500); // let chunks and sessions settle
  }

  bot(name: string): TestBot {
    const bot = this.bots[name];
    if (bot === undefined) {
      throw new Error(`Bot ${name} has not joined.`);
    }
    return bot;
  }

  clearAll(): void {
    for (const bot of Object.values(this.bots)) {
      bot.clear();
    }
  }

  /** Sends a chat message or slash command as a bot and returns the plain texts it receives. */
  async say(name: string, text: string, waitMs = 1000): Promise<string[]> {
    const bot = this.bot(name);
    bot.clear();
    bot.chat(text);
    await sleep(waitMs);
    return bot.messages.map((message) => message.text);
  }

  /**
   * Teleports a player. Integer coordinates put the player at the block center (`+0.5`). With
   * `world` (for example `minecraft:the_nether`) the player moves to that dimension.
   */
  async teleport(
    name: string,
    x: number,
    y: number,
    z: number,
    options: { world?: string; waitMs?: number } = {},
  ): Promise<void> {
    const command = `tp ${name} ${x} ${y} ${z}`;
    await this.server.runUntil(
      options.world === undefined ? command : `execute in ${options.world} run ${command}`,
      /Teleported|No entity|Invalid/,
      options.waitMs ?? 3000,
    );
    await sleep(300); // the client needs a moment to take the new position
  }

  /** Runs a console command in another dimension and returns the log lines printed within `waitMs`. */
  async inWorld(world: string, command: string, waitMs = 600): Promise<string[]> {
    return this.server.run(`execute in ${world} run ${command}`, waitMs);
  }

  /**
   * Places a block through the console (`setblock`). The chunk must be loaded (`forceload add`).
   * `mode` `destroy` breaks the old block with drops; neither mode fires a player block event, so a
   * plugin that listens to `BlockBreakEvent` is not triggered. Returns the server's answer.
   */
  async setBlock(
    x: number,
    y: number,
    z: number,
    block: string,
    options: { world?: string; mode?: "replace" | "destroy" | "keep" } = {},
  ): Promise<string[]> {
    const command = `setblock ${x} ${y} ${z} ${block} ${options.mode ?? "replace"}`;
    return this.server.runUntil(
      options.world === undefined ? command : `execute in ${options.world} run ${command}`,
      /Changed the block|Could not set|not loaded|outside of the world/,
    );
  }

  /** Fills a cuboid through the console (`fill`). Same rules as {@link setBlock}. */
  async fill(
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    block: string,
    options: { world?: string; mode?: "replace" | "destroy" | "keep" | "hollow" | "outline" } = {},
  ): Promise<string[]> {
    const command = `fill ${from.join(" ")} ${to.join(" ")} ${block} ${options.mode ?? "replace"}`;
    return this.server.runUntil(
      options.world === undefined ? command : `execute in ${options.world} run ${command}`,
      /Successfully filled|Could not|not loaded|outside of the world|No blocks/,
    );
  }

  /**
   * Sends a chat message or command as a bot and returns the plain texts it received, as soon as a
   * message matches `until` (or after `timeoutMs`). Use it for "the bot must receive X" checks;
   * "the bot must not receive X" checks still need {@link say}'s fixed window plus a control.
   */
  async sayUntil(name: string, text: string, until: RegExp, timeoutMs = 3000): Promise<string[]> {
    const bot = this.bot(name);
    bot.clear();
    bot.chat(text);
    await bot.waitFor(() => bot.messages.some((message) => until.test(message.text)), timeoutMs);
    await sleep(100); // let messages that follow the match arrive
    return bot.messages.map((message) => message.text);
  }

  /**
   * Runs a helper plugin command and returns the structured `E2E` lines it printed. Returns as
   * soon as the first helper line appears; `timeoutMs` only matters for a command that prints none.
   */
  async helper(command: string, timeoutMs = 1500): Promise<HelperLine[]> {
    const lines = await this.server.runUntil(command, /\bE2E [A-Z0-9_]+/, timeoutMs);
    return lines.flatMap((line) => {
      const parsed = parseHelperLine(line);
      return parsed === null ? [] : [parsed];
    });
  }

  /**
   * Sets a permission through LuckPerms (install it with `prepare --plugin luckperms`):
   * `true`/`false` set the node, `unset` removes it. Returns the log lines LuckPerms printed.
   */
  async permission(
    name: string,
    node: string,
    value: "true" | "false" | "unset",
  ): Promise<string[]> {
    const action = value === "unset" ? `unset ${node}` : `set ${node} ${value}`;
    return this.server.runUntil(`lp user ${name} permission ${action}`, /\[LP\]/, 3000, 150);
  }

  async position(name: string): Promise<PlayerPosition | null> {
    const lines = await this.helper(`e2epos ${name}`);
    for (const line of lines) {
      const position = toPosition(line);
      if (position?.player === name) {
        return position;
      }
    }
    return null;
  }

  async stop(): Promise<void> {
    for (const bot of Object.values(this.bots)) {
      await bot.quit();
    }
    for (const name of Object.keys(this.bots)) {
      delete this.bots[name];
    }
    await this.server.stop();
  }
}
