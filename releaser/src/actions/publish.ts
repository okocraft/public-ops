import * as core from '@actions/core';
import { publishBundle, OctokitReleaseGateway } from '../publish.js';

async function main(): Promise<void> {
  const bundle = core.getInput('bundle-directory', { required: true });
  const token = core.getInput('token', { required: true });
  core.setSecret(token);
  const mode = core.getInput('mode', { required: true });
  if (mode !== 'public' && mode !== 'private') {
    throw new Error('Publishing mode must be public or private');
  }
  const url = await publishBundle(
    bundle, new OctokitReleaseGateway(token), mode, process.env.GITHUB_REPOSITORY,
  );
  core.setOutput('release-url', url);
  core.info('Published and verified release: ' + url);
}
void main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : 'Unexpected release publication failure');
});
