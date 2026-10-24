import * as core from '@actions/core';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prepare } from '../discovery.js';
import { verifyBundle } from '../manifest.js';
import { parseRequest } from '../request.js';

async function main(): Promise<void> {
  const requestFile = core.getInput('request-file', { required: true });
  const workspace = core.getInput('workspace', { required: true });
  const bundle = core.getInput('bundle-directory', { required: true });
  const request = parseRequest(JSON.parse(await readFile(requestFile, 'utf8')) as unknown);
  await prepare(workspace, request, bundle);
  await verifyBundle(bundle);
  core.setOutput('manifest', path.join(bundle, 'manifest.json'));
  core.info('Prepared and verified immutable release bundle for ' + request.repository);
}
void main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : 'Unexpected release preparation failure');
});
