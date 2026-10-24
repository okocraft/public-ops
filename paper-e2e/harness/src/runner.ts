import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { E2eEnv, type E2eEnvOptions } from "./env.ts";
import { Recorder, type CheckResult } from "./recorder.ts";
import type { Scenario } from "./scenario.ts";
import { cdsReadArgs, createSlot, removeSlot, warmUp } from "./slots.ts";
import { DEFAULT_JVM_ARGS } from "./paper.ts";

export interface RunOptions {
  readonly env: E2eEnvOptions;
  /**
   * Directory that receives each scenario's console log as `<scenario id>.log`. The server
   * directory keeps only the last run's log, so set this whenever more than one scenario runs.
   */
  readonly logDir?: string;
  /** Number of scenarios that run at the same time, each on its own server (default 1). */
  readonly parallel?: number;
  /** Port of the first worker; worker `n` uses `basePort + n` (default 25565). */
  readonly basePort?: number;
  /** Prepare a class-data-sharing archive once to shorten every server start (default true). */
  readonly cds?: boolean;
  readonly onScenario?: (scenario: Scenario) => void;
}

/**
 * Runs scenarios, each on a fresh server. A scenario that throws is recorded as FAIL with the
 * error, never skipped silently, and the server is always stopped. With `parallel > 1`, scenarios
 * run in isolated copies of the server directory on different ports; the results keep the order of
 * `scenarios`.
 */
export async function runScenarios(
  scenarios: readonly Scenario[],
  options: RunOptions,
): Promise<Recorder> {
  const serverDir = resolve(options.env.server.dir);
  const parallel = Math.max(1, Math.min(options.parallel ?? 1, scenarios.length));
  const basePort = options.basePort ?? options.env.port ?? 25565;

  let cdsArgs: string[] = [];
  if (options.cds ?? true) {
    if (await warmUp(serverDir, options.env.server.java, options.env.server.jar)) {
      console.log("Created the class-data-sharing archive (first run only).");
    }
    cdsArgs = cdsReadArgs(serverDir);
  }
  const jvmArgs = [...(options.env.server.jvmArgs ?? DEFAULT_JVM_ARGS), ...cdsArgs];
  // Workers run the prepared jar by absolute path so the archive recorded for it stays valid.
  const jar = resolve(serverDir, options.env.server.jar ?? "paper.jar");

  const results: (readonly CheckResult[])[] = scenarios.map(() => []);
  let next = 0;
  const worker = async (index: number): Promise<void> => {
    const dir = parallel > 1 ? createSlot(serverDir, index) : serverDir;
    const env: E2eEnvOptions = {
      ...options.env,
      port: basePort + index,
      server: { ...options.env.server, dir, jar, jvmArgs },
    };
    try {
      for (let current = next++; current < scenarios.length; current = next++) {
        const scenario = scenarios[current];
        if (scenario !== undefined) {
          options.onScenario?.(scenario);
          results[current] = await runOne(scenario, env, options.logDir);
        }
      }
    } finally {
      if (parallel > 1) {
        removeSlot(serverDir, index);
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, (_, index) => worker(index)));

  const recorder = new Recorder();
  for (const group of results) {
    recorder.append(group);
  }
  return recorder;
}

async function runOne(
  scenario: Scenario,
  envOptions: E2eEnvOptions,
  logDir: string | undefined,
): Promise<readonly CheckResult[]> {
  const recorder = new Recorder();
  const env = new E2eEnv(envOptions);
  try {
    await env.start({
      fresh: true,
      setupCommands: scenario.setupCommands ?? [],
      files: scenario.files ?? {},
    });
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
    archiveLog(env.server.dir, logDir, scenario.id);
  }
  return recorder.results;
}

function archiveLog(serverDir: string, logDir: string | undefined, scenarioId: string): void {
  const source = join(serverDir, "e2e-console.log");
  if (logDir === undefined || !existsSync(source)) {
    return;
  }
  mkdirSync(logDir, { recursive: true });
  copyFileSync(source, join(logDir, `${scenarioId.replaceAll(/[^\w.-]/g, "_")}.log`));
}
