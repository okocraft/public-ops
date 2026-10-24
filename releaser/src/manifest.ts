import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseRequest, tagFor } from './request.js';
import { ReleaseError, type ReleaseAsset, type ReleaseManifest } from './types.js';

const digestPattern = /^[0-9a-f]{64}$/;
const namePattern = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,199}$/;
export const MAX_ASSET_BYTES = 256 * 1024 * 1024;
export const MAX_ASSETS = 20;

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReleaseError('Expected JSON object');
  }
  return value as Record<string, unknown>;
}

export async function sha256(filename: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

export async function inspectAsset(filename: string): Promise<ReleaseAsset> {
  const name = path.basename(filename);
  const stats = await lstat(filename);
  if (!namePattern.test(name) || name === 'checksums.txt' || name === 'manifest.json') {
    throw new ReleaseError('Unsafe binary name: ' + name);
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size === 0 ||
      stats.size > MAX_ASSET_BYTES) {
    throw new ReleaseError('Invalid asset size or type: ' + name);
  }
  return { name, size: stats.size, sha256: await sha256(filename) };
}

export function parseManifest(input: unknown): ReleaseManifest {
  const data = asRecord(input);
  const fields = ['schema_version','repository','version','target_sha','tag','build_tool','assets'];
  if (Object.keys(data).sort().join(',') !== fields.sort().join(',')) {
    throw new ReleaseError('Missing or unsupported manifest fields');
  }
  const request = parseRequest({
    schema_version: data.schema_version,
    repository: data.repository,
    version: data.version,
    target_sha: data.target_sha,
  });
  if (data.tag !== tagFor(request) || (data.build_tool !== 'gradle' && data.build_tool !== 'maven')) {
    throw new ReleaseError('Manifest tag or build tool disagrees with request');
  }
  if (!Array.isArray(data.assets) || data.assets.length < 2 ||
      data.assets.length > MAX_ASSETS + 1) {
    throw new ReleaseError('Invalid manifest asset count');
  }
  const assets: ReleaseAsset[] = [];
  const seen = new Set<string>();
  for (const item of data.assets) {
    const asset = asRecord(item);
    if (Object.keys(asset).sort().join(',') !== 'name,sha256,size' ||
        typeof asset.name !== 'string' || !namePattern.test(asset.name) ||
        typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) ||
        asset.size < 1 || asset.size > MAX_ASSET_BYTES ||
        typeof asset.sha256 !== 'string' || !digestPattern.test(asset.sha256)) {
      throw new ReleaseError('Invalid manifest asset');
    }
    if (seen.has(asset.name.toLowerCase())) throw new ReleaseError('Duplicate asset name');
    seen.add(asset.name.toLowerCase());
    assets.push({ name: asset.name, size: asset.size, sha256: asset.sha256 });
  }
  if (assets.at(-1)?.name !== 'checksums.txt') {
    throw new ReleaseError('Missing checksums.txt in manifest');
  }
  return { ...request, tag: data.tag, build_tool: data.build_tool, assets };
}

export async function verifyBundle(bundle: string): Promise<ReleaseManifest> {
  const root = await realpath(bundle);
  const manifestPath = path.join(root, 'manifest.json');
  if ((await lstat(manifestPath)).isSymbolicLink()) {
    throw new ReleaseError('Manifest symlink is not allowed');
  }
  const manifest = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown);
  const expected = new Set(['manifest.json', ...manifest.assets.map((item) => item.name)]);
  const names = await readdir(root);
  if (names.length !== expected.size || names.some((name) => !expected.has(name))) {
    throw new ReleaseError('Unexpected or missing bundle file');
  }
  for (const asset of manifest.assets) {
    const filename = path.join(root, asset.name);
    const stats = await lstat(filename);
    if (!stats.isFile() || stats.isSymbolicLink() ||
        stats.size !== asset.size || (await sha256(filename)) !== asset.sha256) {
      throw new ReleaseError('Asset digest mismatch: ' + asset.name);
    }
  }
  const expectedChecksums = manifest.assets.slice(0, -1)
    .map((asset) => asset.sha256 + '  ' + asset.name + '\n').join('');
  if ((await readFile(path.join(root, 'checksums.txt'), 'utf8')) !== expectedChecksums) {
    throw new ReleaseError('Checksum manifest mismatch');
  }
  return manifest;
}
