import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { detectBuildTool, discoverBinaries, prepare } from '../src/discovery.js';
import { verifyBundle } from '../src/manifest.js';
import { parseRequest } from '../src/request.js';

const execFile = promisify(execFileCb);
const paperZip = Buffer.from(
  'UEsDBBQAAAAIAIIxWF0F9G8WIgAAACAAAAAQAAAAcGFwZXItcGx1Z2luLnltbMtLzE21UohMzM3MS0xK5SpLLSrOzM+zUlA30DPUM1DnAgBQSwECFAMUAAAACACCMVhdBfRvFiIAAAAgAAAAEAAAAAAAAAAAAAAAgAEAAAAAcGFwZXItcGx1Z2luLnltbFBLBQYAAAAAAQABAD4AAABQAAAAAAA=',
  'base64',
);
const velocityZip = Buffer.from(
  'UEsDBBQAAAAIAIIxWF3xX8kkJgAAACYAAAAUAAAAdmVsb2NpdHktcGx1Z2luLmpzb26rVspMUbJSUKpMzM3MS0xKVdJRUCpLLSrOzM8DCRvoGeoZKNUCAFBLAQIUAxQAAAAIAIIxWF3xX8kkJgAAACYAAAAUAAAAAAAAAAAAAACAAQAAAAB2ZWxvY2l0eS1wbHVnaW4uanNvblBLBQYAAAAAAQABAEIAAABYAAAAAAA=',
  'base64',
);

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createFixture(kind: 'gradle' | 'maven'): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-discovery-'));
  dirs.push(root);
  if (kind === 'gradle') {
    await writeFile(path.join(root, 'gradlew'), '#!/bin/sh\n');
    await writeFile(path.join(root, 'build.gradle.kts'), 'plugins {}\n');
    await writeFile(
      path.join(root, 'settings.gradle.kts'),
      'addProject("paper")\naddProject("velocity")\n',
    );
    await writeFile(path.join(root, 'gradle.properties'), 'version=0.1.0\n');
    await mkdir(path.join(root, 'build', 'libs'), { recursive: true });
    await writeFile(path.join(root, 'build', 'libs', 'Yaminabe-Paper-0.1.0.jar'), paperZip);
    await writeFile(path.join(root, 'build', 'libs', 'Yaminabe-Velocity-0.1.0.jar'), velocityZip);
    await writeFile(
      path.join(root, 'build', 'libs', 'common.jar'),
      Buffer.from(
        'UEsDBBQAAAAIAOExWF3MOw+pBQAAAAMAAAAZAAAAY29tL2V4YW1wbGUvTGlicmFyeS5jbGFzc8vJTAIAUEsBAhQDFAAAAAgA4TFYXcw7D6kFAAAAAwAAABkAAAAAAAAAAAAAAIABAAAAAGNvbS9leGFtcGxlL0xpYnJhcnkuY2xhc3NQSwUGAAAAAAEAAQBHAAAAPAAAAAAA',
        'base64',
      ),
    );
  } else {
    await writeFile(
      path.join(root, 'pom.xml'),
      '<project xmlns="http://maven.apache.org/POM/4.0.0"><version>0.1.0</version></project>',
    );
    await mkdir(path.join(root, 'target'), { recursive: true });
    await writeFile(path.join(root, 'target', 'Hugs.jar'), paperZip);
  }
  await execFile('git', ['init', '-q', root]);
  await execFile('git', [
    '-C',
    root,
    '-c',
    'user.name=CI',
    '-c',
    'user.email=ci@example.com',
    'commit',
    '--allow-empty',
    '-m',
    'fixture',
  ]);
  return root;
}

describe('zero-config distribution discovery', () => {
  it('selects only Paper and Velocity distributables for Gradle', async () => {
    const root = await createFixture('gradle');
    const candidates = await discoverBinaries(root, await detectBuildTool(root), '0.1.0');
    expect(candidates.map((value) => path.basename(value))).toEqual([
      'Yaminabe-Paper-0.1.0.jar',
      'Yaminabe-Velocity-0.1.0.jar',
    ]);
    const sha = (await execFile('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
    const bundle = path.join(root, 'bundle');
    await prepare(
      root,
      parseRequest({
        schema_version: 1,
        repository: 'okocraft/Yaminabe',
        version: '0.1.0',
        target_sha: sha,
      }),
      bundle,
    );
    expect((await verifyBundle(bundle)).assets).toHaveLength(3);
  });

  it('supports Maven without project-specific Releaser files', async () => {
    const root = await createFixture('maven');
    expect(await discoverBinaries(root, await detectBuildTool(root), '0.1.0')).toHaveLength(1);
  });

  it('rejects missing platform artifacts rather than publishing partial binaries', async () => {
    const root = await createFixture('gradle');
    await rm(path.join(root, 'build', 'libs', 'Yaminabe-Velocity-0.1.0.jar'));
    await expect(discoverBinaries(root, 'gradle', '0.1.0')).rejects.toThrow('Expected platform');
  });

  it('rejects a wrong source version before staging', async () => {
    const root = await createFixture('gradle');
    const sha = (await execFile('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
    await expect(
      prepare(
        root,
        parseRequest({
          schema_version: 1,
          repository: 'okocraft/Yaminabe',
          version: '1.4',
          target_sha: sha,
        }),
        path.join(root, 'bundle'),
      ),
    ).rejects.toThrow('version mismatch');
  });
});
