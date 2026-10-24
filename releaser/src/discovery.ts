import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { parse as parseYaml } from 'yaml';
import yauzl from 'yauzl';
import { inspectAsset, MAX_ASSETS, MAX_ASSET_BYTES } from './manifest.js';
import { tagFor } from './request.js';
import { ReleaseError, type ReleaseAsset, type ReleaseManifest, type ReleaseRequest } from './types.js';

const execFile = promisify(execFileCb);
type BuildTool = 'gradle' | 'maven';
type Platform = 'paper' | 'velocity';

async function exists(filename: string): Promise<boolean> {
  try { await readFile(filename); return true; } catch { return false; }
}

export async function detectBuildTool(root: string): Promise<BuildTool> {
  const gradle = await exists(path.join(root, 'gradlew')) &&
    (await exists(path.join(root, 'build.gradle.kts')) ||
     await exists(path.join(root, 'build.gradle')));
  const maven = await exists(path.join(root, 'pom.xml'));
  if (gradle === maven) throw new ReleaseError('Exactly one Gradle or Maven build is required');
  return gradle ? 'gradle' : 'maven';
}

async function readVersion(root: string, tool: BuildTool): Promise<string> {
  if (tool === 'gradle') {
    const text = await readFile(path.join(root, 'gradle.properties'), 'utf8');
    const versions = [...text.matchAll(/^\s*version\s*=\s*(\S+)\s*$/gm)].map((match) => match[1]);
    if (versions.length !== 1 || !versions[0]) throw new ReleaseError('Missing Gradle version');
    return versions[0];
  }
  const source = await readFile(path.join(root, 'pom.xml'), 'utf8');
  const parsed: unknown = new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(source);
  if (parsed === null || typeof parsed !== 'object' || !('project' in parsed)) {
    throw new ReleaseError('Invalid Maven pom.xml');
  }
  const project = parsed.project as { version?: unknown; parent?: { version?: unknown } };
  const version = project.version ?? project.parent?.version;
  if (typeof version !== 'string' || version.includes('$' + '{')) {
    throw new ReleaseError('Unresolved Maven project version');
  }
  return version;
}

function expectedPlatforms(settings: string): Set<Platform> {
  const expected = new Set<Platform>();
  for (const platform of ['paper', 'velocity'] as const) {
    const name = new RegExp('(?:addProject|include)\\(\\s*"[^"]*' + platform + '[^"]*"\\s*\\)');
    if (name.test(settings)) expected.add(platform);
  }
  return expected;
}

async function pluginMetadata(filename: string): Promise<{ platform: Platform; version: string } | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(new ReleaseError('Invalid ZIP archive')); return; }
      let discovered: { platform: Platform; version: string } | null = null;
      let settled = false;
      function fail(error: Error): void {
        if (settled) return;
        settled = true;
        zip?.close();
        reject(error);
      }
      zip.once('error', (error: Error) => fail(error));
      zip.once('end', () => {
        if (!settled) { settled = true; resolve(discovered); }
      });
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName;
        const relevant = name === 'paper-plugin.yml' ||
          name === 'plugin.yml' || name === 'velocity-plugin.json';
        if (!relevant) { zip.readEntry(); return; }
        if (entry.uncompressedSize > 1024 * 1024) {
          fail(new ReleaseError('Oversized plugin metadata in ' + path.basename(filename)));
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { fail(new ReleaseError('Cannot read JAR metadata')); return; }
          const chunks: Buffer[] = [];
          let total = 0;
          stream.on('data', (data: Buffer) => {
            total += data.length;
            if (total > 1024 * 1024) {
              stream.destroy(new ReleaseError('Plugin metadata exceeds size limit'));
            } else { chunks.push(data); }
          });
          stream.once('error', fail);
          stream.once('end', () => {
            if (settled) return;
            try {
              const raw = Buffer.concat(chunks).toString('utf8');
              const parsed: unknown = name === 'velocity-plugin.json'
                ? JSON.parse(raw) as unknown : parseYaml(raw) as unknown;
              if (parsed === null || typeof parsed !== 'object' ||
                  !('version' in parsed) || typeof parsed.version !== 'string') {
                throw new ReleaseError('Missing plugin version in ' + name);
              }
              const platform: Platform = name === 'velocity-plugin.json' ? 'velocity' : 'paper';
              if (discovered && discovered.platform !== platform) {
                throw new ReleaseError('Ambiguous plugin metadata in ' + filename);
              }
              discovered = { platform, version: parsed.version };
              zip.readEntry();
            } catch (error) {
              fail(error instanceof Error ? error : new ReleaseError('Invalid plugin metadata'));
            }
          });
        });
      });
      zip.readEntry();
    });
  });
}

export async function discoverBinaries(root: string, tool: BuildTool, version: string): Promise<string[]> {
  const dirs = tool === 'gradle'
    ? [path.join(root, 'build', 'libs')]
    : [path.join(root, 'target'), ...((await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name, 'target')))];
  const binaries: string[] = [];
  const platforms = new Set<string>();
  const names = new Set<string>();
  const resolvedRoot = await realpath(root);
  for (const dir of dirs) {
    let filenames: string[];
    try { filenames = await readdir(dir); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const name of filenames.sort()) {
      if (!name.endsWith('.jar') || /-(?:plain|sources|javadoc|tests?|test-fixtures)\.jar$/i.test(name)) continue;
      const full = path.join(dir, name);
      if (!(await realpath(full)).startsWith(resolvedRoot + path.sep)) {
        throw new ReleaseError('Unsafe JAR location');
      }
      const asset = await inspectAsset(full);
      if (asset.size > MAX_ASSET_BYTES) throw new ReleaseError('JAR too large');
      const plugin = await pluginMetadata(full);
      if (!plugin) continue;
      if (plugin.version !== version) throw new ReleaseError('Plugin version mismatch in ' + name);
      if (platforms.has(plugin.platform) || names.has(asset.name.toLowerCase())) {
        throw new ReleaseError('Ambiguous duplicate release binary');
      }
      platforms.add(plugin.platform);
      names.add(asset.name.toLowerCase());
      binaries.push(full);
    }
  }
  if (!binaries.length || binaries.length > MAX_ASSETS) throw new ReleaseError('No safe distribution JARs');
  if (tool === 'gradle') {
    let settings = '';
    for (const filename of ['settings.gradle.kts', 'settings.gradle']) {
      if (await exists(path.join(root, filename))) {
        settings = await readFile(path.join(root, filename), 'utf8');
        break;
      }
    }
    const required = expectedPlatforms(settings);
    if ([...required].some((p) => !platforms.has(p))) {
      throw new ReleaseError('Expected platform binary was not produced');
    }
  }
  return binaries;
}

export async function prepare(
  workspace: string, request: ReleaseRequest, bundle: string,
): Promise<ReleaseManifest> {
  const root = await realpath(workspace);
  const { stdout } = await execFile('git', ['-C', root, 'rev-parse', 'HEAD']);
  if (stdout.trim() !== request.target_sha) throw new ReleaseError('Checkout commit SHA mismatch');
  const tool = await detectBuildTool(root);
  if ((await readVersion(root, tool)) !== request.version ||
      request.version.toUpperCase().includes('SNAPSHOT')) {
    throw new ReleaseError('Source version mismatch or snapshot version');
  }
  const jars = await discoverBinaries(root, tool, request.version);
  // Fail before writing if destination already exists, including a symlink.
  await mkdir(bundle, { recursive: false });
  const assets: ReleaseAsset[] = [];
  for (const jar of jars) {
    const destination = path.join(bundle, path.basename(jar));
    await copyFile(jar, destination);
    assets.push(await inspectAsset(destination));
  }
  const checksums = assets.map((asset) => asset.sha256 + '  ' + asset.name + '\n').join('');
  const checksumsFile = path.join(bundle, 'checksums.txt');
  await writeFile(checksumsFile, checksums, 'utf8');
  const stat = await import('node:fs/promises');
  const checksumAsset = {
    name: 'checksums.txt',
    size: (await stat.stat(checksumsFile)).size,
    sha256: (await import('./manifest.js')).sha256(checksumsFile),
  };
  const manifest: ReleaseManifest = {
    ...request, tag: tagFor(request), build_tool: tool,
    assets: [...assets, { ...checksumAsset, sha256: await checksumAsset.sha256 }],
  };
  await writeFile(path.join(bundle, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
