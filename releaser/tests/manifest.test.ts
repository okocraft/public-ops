import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256, parseManifest, verifyBundle } from '../src/manifest.js';

const temp: string[] = [];
afterEach(async () => {
  await Promise.all(temp.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const bundle = await mkdtemp(path.join(os.tmpdir(), 'releaser-'));
  temp.push(bundle);
  await writeFile(path.join(bundle, 'Paper.jar'), 'some jar bytes');
  const digest = await sha256(path.join(bundle, 'Paper.jar'));
  const checksums = digest + '  Paper.jar\n';
  await writeFile(path.join(bundle, 'checksums.txt'), checksums);
  const manifest = {
    schema_version: 1,
    repository: 'okocraft/Yaminabe',
    version: '0.1.0',
    target_sha: 'a'.repeat(40),
    tag: 'v0.1.0',
    build_tool: 'gradle',
    assets: [
      { name: 'Paper.jar', size: 14, sha256: digest },
      { name: 'checksums.txt', size: Buffer.byteLength(checksums), sha256: await sha256(path.join(bundle, 'checksums.txt')) },
    ],
  };
  await writeFile(path.join(bundle, 'manifest.json'), JSON.stringify(manifest));
  return bundle;
}

describe('manifest integrity', () => {
  it('verifies exact expected files', async () => {
    const bundle = await fixture();
    expect((await verifyBundle(bundle)).tag).toBe('v0.1.0');
  });
  it('rejects tampered bytes before publication', async () => {
    const bundle = await fixture();
    await writeFile(path.join(bundle, 'Paper.jar'), 'changed bytes!');
    await expect(verifyBundle(bundle)).rejects.toThrow('digest');
  });
  it('rejects extra bundle files', async () => {
    const bundle = await fixture();
    await writeFile(path.join(bundle, 'unexpected.txt'), 'unexpected');
    await expect(verifyBundle(bundle)).rejects.toThrow('Unexpected');
  });
  it('refuses manifest-injected traversal or additional fields', async () => {
    const bundle = await fixture();
    const manifest = JSON.parse(await readFile(path.join(bundle, 'manifest.json'), 'utf8')) as { assets: Array<{name: string}> };
    manifest.assets[0]!.name = '../outside';
    expect(() => parseManifest(manifest)).toThrow();
  });
});
