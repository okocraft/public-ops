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
  /** Bots that must be connected before `run`. */
  readonly bots?: readonly string[];
  /** Console commands to run after the server starts. */
  readonly setupCommands?: readonly string[];
  run(env: E2eEnv, recorder: Recorder): Promise<void>;
}

export function defineScenario(scenario: Scenario): Scenario {
  return scenario;
}
