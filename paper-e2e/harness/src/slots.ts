import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { PaperServer, DEFAULT_JVM_ARGS } from "./paper.ts";

/** Large, read-only directories that a Paper server only reads after its first start. */
const SHARED_DIRS = ["cache", "libraries", "versions"] as const;

/** Small configuration the slots copy from the prepared server directory. */
const COPIED_PATHS = ["plugins", "config", "bukkit.yml", "spigot.yml", "commands.yml"] as const;

/** Path of the class-data-sharing archive that shortens JVM and Paper start-up. */
export function cdsArchivePath(serverDir: string): string {
  return join(resolve(serverDir), ".e2e", "app.jsa");
}

/** JVM flags that use an existing archive without ever writing it. */
export function cdsReadArgs(serverDir: string): string[] {
  return existsSync(cdsArchivePath(serverDir))
    ? [`-XX:SharedArchiveFile=${cdsArchivePath(serverDir)}`, "-Xshare:auto"]
    : [];
}

/**
 * Starts the prepared server once and stops it again so that the JVM writes a class-data-sharing
 * archive (and Paper fills `cache/` and `libraries/`). Later starts load Paper noticeably faster
 * (about 15 s down to 10 s on a 4-core machine). Skipped when the archive exists; delete
 * `<server-dir>/.e2e/app.jsa` after changing the Java version or `paper.jar`.
 */
export async function warmUp(
  serverDir: string,
  java = "java",
  jar = "paper.jar",
): Promise<boolean> {
  const archive = cdsArchivePath(serverDir);
  if (existsSync(archive)) {
    return false;
  }
  mkdirSync(dirname(archive), { recursive: true });
  const server = new PaperServer({
    dir: serverDir,
    java,
    jar: resolve(serverDir, jar), // the archive is keyed by the jar path, so use the same absolute path as the workers
    jvmArgs: [
      ...DEFAULT_JVM_ARGS,
      "-XX:+AutoCreateSharedArchive",
      `-XX:SharedArchiveFile=${archive}`,
    ],
  });
  server.reset();
  await server.start();
  await server.stop();
  server.reset();
  return true;
}

/** Directory of the `index`-th parallel worker next to the prepared server directory. */
export function slotDir(serverDir: string, index: number): string {
  const dir = resolve(serverDir);
  return join(dirname(dir), `${basename(dir)}.slot${index}`);
}

/**
 * Creates an isolated server directory for one parallel worker: the heavy read-only directories
 * are linked, the plugins and configuration are copied. Run {@link warmUp} first so that the
 * linked directories are complete.
 */
export function createSlot(serverDir: string, index: number): string {
  const source = resolve(serverDir);
  const target = slotDir(serverDir, index);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const name of SHARED_DIRS) {
    if (existsSync(join(source, name))) {
      symlinkSync(join(source, name), join(target, name), "dir");
    }
  }
  for (const name of COPIED_PATHS) {
    if (existsSync(join(source, name))) {
      cpSync(join(source, name), join(target, name), { recursive: true });
    }
  }
  return target;
}

export function removeSlot(serverDir: string, index: number): void {
  rmSync(slotDir(serverDir, index), { recursive: true, force: true });
}
