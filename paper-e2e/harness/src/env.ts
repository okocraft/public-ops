import { TestBot, type TestBotOptions } from "./bot.ts";
import { parseHelperLine, toPosition, type HelperLine, type PlayerPosition } from "./helper-log.ts";
import { PaperServer, type PaperServerOptions } from "./paper.ts";
import { sleep } from "./text.ts";

export interface E2eEnvOptions {
  readonly server: PaperServerOptions;
  /** Client version for bots; see `chooseClientVersion`. */
  readonly clientVersion: string;
  /** Extra paths (relative to the server directory) to delete when starting from a clean state. */
  readonly resetPaths?: readonly string[];
}

/** A running test server plus the bots connected to it. */
export class E2eEnv {
  readonly server: PaperServer;
  readonly bots: Record<string, TestBot> = {};
  readonly #options: E2eEnvOptions;

  constructor(options: E2eEnvOptions) {
    this.#options = options;
    this.server = new PaperServer(options.server);
  }

  /** Starts the server. With `fresh`, worlds and `resetPaths` are deleted first. */
  async start(options: { fresh?: boolean; setupCommands?: readonly string[] } = {}): Promise<void> {
    if (options.fresh ?? true) {
      this.server.reset(this.#options.resetPaths);
    }
    await this.server.start();
    for (const command of options.setupCommands ?? []) {
      this.server.command(command);
      await sleep(300);
    }
  }

  async join(...names: string[]): Promise<void> {
    for (const username of names) {
      const options: TestBotOptions = { username, version: this.#options.clientVersion };
      const bot = new TestBot(options);
      await bot.join();
      this.bots[username] = bot;
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

  async teleport(name: string, x: number, y: number, z: number, waitMs = 1500): Promise<void> {
    this.server.command(`tp ${name} ${x} ${y} ${z}`);
    await sleep(waitMs);
  }

  /** Runs a helper plugin command and returns the structured `E2E` lines it printed. */
  async helper(command: string, waitMs = 500): Promise<HelperLine[]> {
    const lines = await this.server.run(command, waitMs);
    return lines.flatMap((line) => {
      const parsed = parseHelperLine(line);
      return parsed === null ? [] : [parsed];
    });
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
