import type { BotSpec } from "./bot.ts";
import type { E2eEnv } from "./env.ts";
import { Recorder } from "./recorder.ts";

/**
 * An executable scenario. `id` should match an operation in the plugin's TESTING.md
 * (for example `OP-001`) so results trace back to the test viewpoints.
 */
export interface Scenario {
  readonly id: string;
  readonly title: string;
  /** Viewpoint / behavior IDs exercised by this scenario, copied from TESTING.md. */
  readonly covers?: readonly string[];
  /** Bots that must be connected before `run`: names, or objects with `recordPackets` / `locale`. */
  readonly bots?: readonly BotSpec[];
  /**
   * Files written into the server directory after the reset and before the server starts, as
   * `{ "plugins/MyPlugin/config.yml": "key: value\n" }`. Use it for per-scenario configuration.
   */
  readonly files?: Readonly<Record<string, string>>;
  /** Console commands to run after the server starts. */
  readonly setupCommands?: readonly string[];
  run(env: E2eEnv, recorder: Recorder): Promise<void>;
}

export function defineScenario(scenario: Scenario): Scenario {
  return scenario;
}
