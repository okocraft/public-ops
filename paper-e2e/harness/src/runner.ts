import { E2eEnv, type E2eEnvOptions } from "./env.ts";
import { Recorder } from "./recorder.ts";
import type { Scenario } from "./scenario.ts";

export interface RunOptions {
  readonly env: E2eEnvOptions;
  /** Paths (relative to the server directory) to delete before every scenario. */
  readonly onScenario?: (scenario: Scenario) => void;
}

/**
 * Runs scenarios one by one, each on a fresh server. A scenario that throws is recorded as FAIL
 * with the error, never skipped silently, and the server is always stopped.
 */
export async function runScenarios(
  scenarios: readonly Scenario[],
  options: RunOptions,
): Promise<Recorder> {
  const recorder = new Recorder();
  for (const scenario of scenarios) {
    options.onScenario?.(scenario);
    const env = new E2eEnv(options.env);
    try {
      await env.start({ fresh: true, setupCommands: scenario.setupCommands ?? [] });
      await env.join(...(scenario.bots ?? []));
      await scenario.run(env, recorder);
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      recorder.check(
        `${scenario.id}:crash`,
        `${scenario.title}: scenario aborted`,
        false,
        message,
        scenario.covers ?? [],
      );
    } finally {
      await env.stop().catch((error: unknown) => {
        console.error(`failed to stop the server cleanly: ${String(error)}`);
      });
    }
  }
  return recorder;
}
