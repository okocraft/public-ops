import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { sha256 } from '../src/manifest.js';
import {
  publishBundle,
  type ReleaseGateway,
  type RemoteRelease,
  type RemoteAsset,
} from '../src/publish.js';
import type { ReleaseManifest } from '../src/types.js';

const SHA = 'a'.repeat(40);

class FakeGateway implements ReleaseGateway {
  tag: string | null = null;
  release: RemoteRelease | null = null;
  files = new Map<string, RemoteAsset>();
  writes = 0;
  async getRepository(): Promise<{ fullName: string; private: boolean }> {
    return { fullName: 'okocraft/Yaminabe', private: false };
  }
  async hasCommit(_repository: string, sha: string): Promise<boolean> {
    return sha === SHA;
  }
  async tagCommit(): Promise<string | null> {
    return this.tag;
  }
  async createTag(_repository: string, _tag: string, sha: string): Promise<void> {
    this.writes++;
    this.tag = sha;
  }
  async getRelease(): Promise<RemoteRelease | null> {
    return this.release;
  }
  async createDraft(): Promise<RemoteRelease> {
    this.writes++;
    this.release = {
      id: 17,
      draft: true,
      htmlUrl: 'https://github.com/okocraft/Yaminabe/releases/tag/v0.1.0',
    };
    return this.release;
  }
  async assets(): Promise<RemoteAsset[]> {
    return [...this.files.values()];
  }
  async upload(
    _repository: string,
    _releaseId: number,
    name: string,
    contents: Buffer,
  ): Promise<RemoteAsset> {
    this.writes++;
    const value: RemoteAsset = {
      name,
      size: contents.length,
      state: 'uploaded',
      digest:
        'sha256:' +
        (await import('node:crypto')).createHash('sha256').update(contents).digest('hex'),
    };
    this.files.set(name, value);
    return value;
  }
  async makePublic(): Promise<RemoteRelease> {
    this.writes++;
    this.release = {
      id: 17,
      draft: false,
      htmlUrl: 'https://github.com/okocraft/Yaminabe/releases/tag/v0.1.0',
    };
    return this.release;
  }
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function fixture(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'release-publish-'));
  dirs.push(directory);
  await writeFile(path.join(directory, 'plugin.jar'), 'some bytes');
  const digest = await sha256(path.join(directory, 'plugin.jar'));
  const checksums = digest + '  plugin.jar\n';
  await writeFile(path.join(directory, 'checksums.txt'), checksums);
  const manifest: ReleaseManifest = {
    schema_version: 1,
    repository: 'okocraft/Yaminabe',
    version: '0.1.0',
    target_sha: SHA,
    tag: 'v0.1.0',
    build_tool: 'gradle',
    assets: [
      { name: 'plugin.jar', size: 10, sha256: digest },
      {
        name: 'checksums.txt',
        size: Buffer.byteLength(checksums),
        sha256: await sha256(path.join(directory, 'checksums.txt')),
      },
    ],
  };
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  return directory;
}

describe('GitHub publication', () => {
  it('publishes after all assets have matching remote SHA-256', async () => {
    const dir = await fixture();
    const fake = new FakeGateway();
    const url = await publishBundle(dir, fake, 'public');
    expect(url).toContain('/releases/tag/v0.1.0');
    expect(fake.release?.draft).toBe(false);
    expect([...fake.files.keys()]).toEqual(['plugin.jar', 'checksums.txt']);
  });
  it('rejects a conflicting existing tag without any write', async () => {
    const dir = await fixture();
    const fake = new FakeGateway();
    fake.tag = 'f'.repeat(40);
    await expect(publishBundle(dir, fake, 'public')).rejects.toThrow('different commit');
    expect(fake.writes).toBe(0);
  });
  it('rejects published versions rather than overwriting assets', async () => {
    const dir = await fixture();
    const fake = new FakeGateway();
    fake.tag = SHA;
    fake.release = {
      id: 17,
      draft: false,
      htmlUrl: 'https://github.com/okocraft/Yaminabe/releases/tag/v0.1.0',
    };
    await expect(publishBundle(dir, fake, 'public')).rejects.toThrow('immutable');
    expect(fake.writes).toBe(0);
  });
  it('rejects a mismatching resumed draft', async () => {
    const dir = await fixture();
    const fake = new FakeGateway();
    fake.tag = SHA;
    fake.release = {
      id: 17,
      draft: true,
      htmlUrl: 'https://github.com/okocraft/Yaminabe/releases/tag/v0.1.0',
    };
    fake.files.set('plugin.jar', {
      name: 'plugin.jar',
      state: 'uploaded',
      size: 10,
      digest: 'sha256:' + '0'.repeat(64),
    });
    await expect(publishBundle(dir, fake, 'public')).rejects.toThrow('digest mismatch');
    expect(fake.writes).toBe(0);
  });
  it('rejects publication for a private repo on the public runner', async () => {
    const dir = await fixture();
    const fake = new FakeGateway();
    await expect(publishBundle(dir, fake, 'private', 'okocraft/Yaminabe')).rejects.toThrow(
      'visibility',
    );
    expect(fake.writes).toBe(0);
  });
  it('rejects modified bundle before fetching GitHub data', async () => {
    const dir = await fixture();
    const fake = new FakeGateway();
    await writeFile(path.join(dir, 'plugin.jar'), 'not authentic');
    await expect(publishBundle(dir, fake, 'public')).rejects.toThrow('digest');
    expect(fake.writes).toBe(0);
  });
});
