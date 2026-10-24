import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface FillBuild {
  readonly id: number;
  readonly downloads: Record<string, { name: string; url: string; checksums: { sha256: string } }>;
}

interface HangarVersions {
  readonly result: readonly {
    readonly name: string;
    readonly downloads: Record<string, { downloadUrl?: string }>;
  }[];
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export interface DownloadedPaper {
  readonly version: string;
  readonly build: number;
  readonly file: string;
}

/** Downloads the latest Paper build of a Minecraft version (PaperMC Fill API) and verifies its SHA-256. */
export async function downloadPaper(version: string, dir: string): Promise<DownloadedPaper> {
  const build = await getJson<FillBuild>(
    `https://fill.papermc.io/v3/projects/paper/versions/${version}/builds/latest`,
  );
  const server = build.downloads["server:default"];
  if (server === undefined) {
    throw new Error(`No server download for Paper ${version}`);
  }
  const bytes = await download(server.url);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== server.checksums.sha256) {
    throw new Error(`SHA-256 mismatch for ${server.name}: ${actual}`);
  }
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "paper.jar");
  writeFileSync(file, bytes);
  return { version, build: build.id, file };
}

/** Downloads the newest release of a Hangar project (for example `ViaVersion`) into `<dir>/plugins`. */
export async function downloadHangarPlugin(slug: string, dir: string): Promise<string> {
  const versions = await getJson<HangarVersions>(
    `https://hangar.papermc.io/api/v1/projects/${slug}/versions?limit=1&channel=Release`,
  );
  const latest = versions.result[0];
  const url = latest?.downloads["PAPER"]?.downloadUrl;
  if (latest === undefined || url === undefined) {
    throw new Error(`No Paper release found for Hangar project ${slug}`);
  }
  mkdirSync(join(dir, "plugins"), { recursive: true });
  const file = join(dir, "plugins", `${slug}-${latest.name}.jar`);
  writeFileSync(file, await download(url));
  return file;
}
