import mineflayer, { type Bot } from "mineflayer";
import { sleep } from "./text.ts";

export interface ReceivedMessage {
  readonly at: number;
  /** Plain text as the client renders it. */
  readonly text: string;
  /** Translation key of the root component, e.g. `death.attack.genericKill`. */
  readonly translate: string | undefined;
}

export interface ReceivedPacket {
  readonly at: number;
  readonly name: string;
  readonly data: unknown;
}

export interface TestBotOptions {
  readonly username: string;
  /** Client protocol version. See {@link chooseClientVersion}. */
  readonly version: string;
  readonly port?: number;
  /** Packet names (regular expression) to keep in {@link TestBot.packets}. */
  readonly recordPackets?: RegExp;
  /** Respawn automatically after dying. */
  readonly autoRespawn?: boolean;
  /** Client locale sent to the server (default `en_US`), e.g. `ja_JP` for locale-dependent messages. */
  readonly locale?: string;
}

/** What `E2eEnv.join` and `Scenario.bots` accept: a bare name, or a name with per-bot options. */
export type BotSpec = string | Omit<TestBotOptions, "version" | "port">;

/** Packets recorded by default: death screen data and container/merchant windows. */
export const DEFAULT_RECORDED_PACKETS = /combat|death|open_window|open_screen|trade|close_window/i;

/**
 * Picks the client version for a server version. mineflayer supports a limited list of versions.
 * When the server is newer, the newest supported client is used and `needsTranslation` is true:
 * the server must then run ViaVersion + ViaBackwards, and the report MUST state this limitation.
 */
export function chooseClientVersion(
  serverVersion: string,
  supported: readonly string[] = mineflayer.testedVersions,
): { version: string; needsTranslation: boolean } {
  if (supported.includes(serverVersion)) {
    return { version: serverVersion, needsTranslation: false };
  }
  const newest = supported.at(-1);
  if (newest === undefined) {
    throw new Error("mineflayer reports no supported versions.");
  }
  return { version: newest, needsTranslation: true };
}

interface RawClient {
  on(event: "packet", listener: (data: unknown, meta: { name: string }) => void): void;
  write: (name: string, params: unknown) => void;
}

/** A real Minecraft protocol client that records what the server sends. */
export class TestBot {
  readonly username: string;
  readonly messages: ReceivedMessage[] = [];
  readonly packets: ReceivedPacket[] = [];
  readonly #options: TestBotOptions;
  #bot: Bot | null = null;

  constructor(options: TestBotOptions) {
    this.username = options.username;
    this.#options = options;
  }

  /** The underlying mineflayer bot, for interactions the wrapper does not cover. */
  get raw(): Bot {
    if (this.#bot === null) {
      throw new Error(`${this.username} has not joined.`);
    }
    return this.#bot;
  }

  async join(timeoutMs = 60_000): Promise<void> {
    const bot = mineflayer.createBot({
      host: "127.0.0.1",
      port: this.#options.port ?? 25565,
      username: this.username,
      auth: "offline",
      version: this.#options.version,
    });
    this.#bot = bot;
    // oxlint-disable-next-line no-underscore-dangle -- mineflayer only exposes the raw protocol client as `_client`
    const client = bot._client as unknown as RawClient;
    const recorded = this.#options.recordPackets ?? DEFAULT_RECORDED_PACKETS;

    bot.once("login", () => {
      bot.physicsEnabled = false;
      suppressMovement(client);
    });
    bot.on("message", (message) => {
      const json = message.json as { translate?: unknown } | undefined;
      this.messages.push({
        at: Date.now(),
        text: message.toString(),
        translate: typeof json?.translate === "string" ? json.translate : undefined,
      });
    });
    client.on("packet", (data, meta) => {
      if (recorded.test(meta.name)) {
        this.packets.push({ at: Date.now(), name: meta.name, data: structuredClone(data) });
      }
    });
    if (this.#options.autoRespawn ?? true) {
      bot.on("death", () => {
        setTimeout(() => bot.respawn(), 300);
      });
    }
    bot.on("error", (error) => console.error(`[bot ${this.username}] ${error.message}`));
    bot.on("kicked", (reason) =>
      console.error(`[bot ${this.username}] kicked: ${JSON.stringify(reason)}`),
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${this.username} did not spawn`)),
        timeoutMs,
      );
      bot.once("spawn", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (this.#options.locale !== undefined) {
      // `locale` is accepted at runtime but missing from mineflayer's `GameSettings` type
      await bot.setSettings({ locale: this.#options.locale } as never);
    }
    await sleep(500);
  }

  /**
   * Right-clicks an entity with an explicit sneaking flag. mineflayer's `activateEntity` always
   * sends `sneaking: false`, which turns sneak-dependent interactions into silent no-ops.
   * Use this for plugins that treat sneak + right-click differently.
   */
  useEntity(entityId: number, options: { sneaking?: boolean; offHand?: boolean } = {}): void {
    this.#client.write("use_entity", {
      target: entityId,
      mouse: 0,
      hand: options.offHand === true ? 1 : 0,
      sneaking: options.sneaking ?? false,
      location: { x: 0, y: 0, z: 0 }, // required by the protocol serializer; unused for a plain interact
    });
  }

  get #client(): RawClient {
    // oxlint-disable-next-line no-underscore-dangle -- mineflayer only exposes the raw protocol client as `_client`
    return this.raw._client as unknown as RawClient;
  }

  chat(text: string): void {
    this.raw.chat(text);
  }

  clear(): void {
    this.messages.length = 0;
    this.packets.length = 0;
  }

  async quit(): Promise<void> {
    this.#bot?.quit();
    await sleep(300);
  }
}

/**
 * mineflayer's movement packets for recent versions can be rejected by the server
 * ("Invalid move player packet"). The bots stay idle, so movement packets are dropped after the
 * teleport handshake. Move bots with server-side teleports (`tp`) instead of walking.
 */
function suppressMovement(client: RawClient): void {
  const write = client.write.bind(client);
  const dropped: ReadonlySet<string> = new Set(["position", "position_look", "look", "flying"]);
  let answeredFirstTeleport = false;
  client.write = (name, params) => {
    if (name === "position_look" && !answeredFirstTeleport) {
      answeredFirstTeleport = true;
      write(name, params);
      return;
    }
    if (!dropped.has(name)) {
      write(name, params);
    }
  };
}
