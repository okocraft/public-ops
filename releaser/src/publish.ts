import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getOctokit } from '@actions/github';
import { isPrerelease } from './request.js';
import { verifyBundle } from './manifest.js';
import { ReleaseError, type ReleaseAsset, type ReleaseManifest } from './types.js';

export interface RemoteAsset {
  readonly name: string;
  readonly state: string;
  readonly size: number;
  readonly digest: string | null | undefined;
}

export interface RemoteRelease {
  readonly id: number;
  readonly draft: boolean;
  readonly htmlUrl: string;
}

export interface ReleaseGateway {
  getRepository(repository: string): Promise<{ fullName: string; private: boolean }>;
  hasCommit(repository: string, sha: string): Promise<boolean>;
  tagCommit(repository: string, tag: string): Promise<string | null>;
  createTag(repository: string, tag: string, sha: string): Promise<void>;
  getRelease(repository: string, tag: string): Promise<RemoteRelease | null>;
  createDraft(manifest: ReleaseManifest): Promise<RemoteRelease>;
  assets(repository: string, releaseId: number): Promise<RemoteAsset[]>;
  upload(
    repository: string,
    releaseId: number,
    name: string,
    contents: Buffer,
  ): Promise<RemoteAsset>;
  makePublic(repository: string, releaseId: number): Promise<RemoteRelease>;
}

function splitRepository(repository: string): { owner: string; repo: string } {
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) throw new ReleaseError('Invalid repository');
  return { owner, repo };
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404;
}

export class OctokitReleaseGateway implements ReleaseGateway {
  private readonly client: ReturnType<typeof getOctokit>;

  constructor(token: string) {
    if (!token) throw new ReleaseError('Missing GitHub API token');
    this.client = getOctokit(token);
  }

  async getRepository(repository: string): Promise<{ fullName: string; private: boolean }> {
    const response = await this.client.rest.repos.get(splitRepository(repository));
    return { fullName: response.data.full_name, private: response.data.private };
  }

  async hasCommit(repository: string, sha: string): Promise<boolean> {
    try {
      const response = await this.client.rest.git.getCommit({
        ...splitRepository(repository),
        commit_sha: sha,
      });
      return response.data.sha === sha;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async tagCommit(repository: string, tag: string): Promise<string | null> {
    let ref: { type: string; sha: string };
    try {
      ref = (
        await this.client.rest.git.getRef({
          ...splitRepository(repository),
          ref: 'tags/' + tag,
        })
      ).data.object;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    for (let depth = 0; depth < 4; depth++) {
      if (ref.type === 'commit') return ref.sha;
      if (ref.type !== 'tag') throw new ReleaseError('Unsupported tag object');
      const response = await this.client.rest.git.getTag({
        ...splitRepository(repository),
        tag_sha: ref.sha,
      });
      ref = response.data.object;
    }
    throw new ReleaseError('Annotated tag recursion limit exceeded');
  }

  async createTag(repository: string, tag: string, sha: string): Promise<void> {
    await this.client.rest.git.createRef({
      ...splitRepository(repository),
      ref: 'refs/tags/' + tag,
      sha,
    });
  }

  async getRelease(repository: string, tag: string): Promise<RemoteRelease | null> {
    try {
      const response = await this.client.rest.repos.getReleaseByTag({
        ...splitRepository(repository),
        tag,
      });
      return {
        id: response.data.id,
        draft: response.data.draft,
        htmlUrl: response.data.html_url,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async createDraft(manifest: ReleaseManifest): Promise<RemoteRelease> {
    const response = await this.client.rest.repos.createRelease({
      ...splitRepository(manifest.repository),
      tag_name: manifest.tag,
      target_commitish: manifest.target_sha,
      name: manifest.tag,
      draft: true,
      prerelease: isPrerelease(manifest.version),
      generate_release_notes: true,
    });
    return {
      id: response.data.id,
      draft: response.data.draft,
      htmlUrl: response.data.html_url,
    };
  }

  async assets(repository: string, releaseId: number): Promise<RemoteAsset[]> {
    const result = await this.client.paginate(this.client.rest.repos.listReleaseAssets, {
      ...splitRepository(repository),
      release_id: releaseId,
      per_page: 100,
    });
    return result.map((item) => ({
      name: item.name,
      state: item.state,
      size: item.size,
      digest: item.digest,
    }));
  }

  async upload(
    repository: string,
    releaseId: number,
    name: string,
    contents: Buffer,
  ): Promise<RemoteAsset> {
    const response = await this.client.rest.repos.uploadReleaseAsset({
      ...splitRepository(repository),
      release_id: releaseId,
      name,
      data: contents as unknown as string,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': contents.byteLength,
      },
    });
    return {
      name: response.data.name,
      state: response.data.state,
      size: response.data.size,
      digest: response.data.digest,
    };
  }

  async makePublic(repository: string, releaseId: number): Promise<RemoteRelease> {
    const response = await this.client.rest.repos.updateRelease({
      ...splitRepository(repository),
      release_id: releaseId,
      draft: false,
    });
    return { id: response.data.id, draft: response.data.draft, htmlUrl: response.data.html_url };
  }
}

function verifyRemote(actual: RemoteAsset, expected: ReleaseAsset): void {
  if (
    actual.name !== expected.name ||
    actual.state !== 'uploaded' ||
    actual.size !== expected.size ||
    actual.digest !== 'sha256:' + expected.sha256
  ) {
    throw new ReleaseError('Remote release asset digest mismatch: ' + expected.name);
  }
}

async function verifyAssets(
  gateway: ReleaseGateway,
  manifest: ReleaseManifest,
  id: number,
): Promise<Map<string, RemoteAsset>> {
  const remote = await gateway.assets(manifest.repository, id);
  const byName = new Map<string, RemoteAsset>();
  for (const item of remote) {
    if (byName.has(item.name)) throw new ReleaseError('Duplicate remote release asset');
    byName.set(item.name, item);
  }
  const expected = new Set(manifest.assets.map((asset) => asset.name));
  if ([...byName.keys()].some((name) => !expected.has(name))) {
    throw new ReleaseError('Unexpected remote release asset');
  }
  return byName;
}

export async function publishBundle(
  bundle: string,
  gateway: ReleaseGateway,
  mode: 'public' | 'private',
  callingRepository?: string,
): Promise<string> {
  const manifest = await verifyBundle(bundle);
  const repository = manifest.repository;
  const identity = await gateway.getRepository(repository);
  if (
    identity.fullName.toLowerCase() !== repository.toLowerCase() ||
    identity.private !== (mode === 'private')
  ) {
    throw new ReleaseError('Target visibility or repository identity mismatch');
  }
  if (mode === 'private' && callingRepository?.toLowerCase() !== repository.toLowerCase()) {
    throw new ReleaseError('Private publish must execute in the target repository');
  }
  if (!(await gateway.hasCommit(repository, manifest.target_sha))) {
    throw new ReleaseError('Requested commit does not exist in target repository');
  }
  const existingTag = await gateway.tagCommit(repository, manifest.tag);
  if (existingTag !== null && existingTag !== manifest.target_sha) {
    throw new ReleaseError('Existing tag points to a different commit');
  }
  let release = await gateway.getRelease(repository, manifest.tag);
  if (release !== null && !release.draft) {
    throw new ReleaseError('Published Release is immutable and cannot be overwritten');
  }
  if (existingTag === null) {
    await gateway.createTag(repository, manifest.tag, manifest.target_sha);
    if ((await gateway.tagCommit(repository, manifest.tag)) !== manifest.target_sha) {
      throw new ReleaseError('Created tag does not match requested commit');
    }
  }
  if (!release) release = await gateway.createDraft(manifest);
  if (!release.draft) throw new ReleaseError('Release is not a draft');

  const remote = await verifyAssets(gateway, manifest, release.id);
  for (const asset of manifest.assets) {
    const existing = remote.get(asset.name);
    if (existing) {
      verifyRemote(existing, asset);
    } else {
      const contents = await readFile(path.join(bundle, asset.name));
      verifyRemote(await gateway.upload(repository, release.id, asset.name, contents), asset);
    }
  }
  const finalAssets = await verifyAssets(gateway, manifest, release.id);
  if (finalAssets.size !== manifest.assets.length) {
    throw new ReleaseError('Release does not contain all required assets');
  }
  for (const asset of manifest.assets) {
    const actual = finalAssets.get(asset.name);
    if (!actual) throw new ReleaseError('Required asset missing: ' + asset.name);
    verifyRemote(actual, asset);
  }
  if ((await gateway.tagCommit(repository, manifest.tag)) !== manifest.target_sha) {
    throw new ReleaseError('Tag changed during publication');
  }
  const published = await gateway.makePublic(repository, release.id);
  if (published.draft) throw new ReleaseError('Release remains draft after publishing');
  const checked = await gateway.getRelease(repository, manifest.tag);
  if (
    !checked ||
    checked.draft ||
    (await gateway.tagCommit(repository, manifest.tag)) !== manifest.target_sha
  ) {
    throw new ReleaseError('Could not verify published Release');
  }
  const uploaded = await verifyAssets(gateway, manifest, release.id);
  for (const asset of manifest.assets) {
    const actual = uploaded.get(asset.name);
    if (!actual) throw new ReleaseError('Published asset missing');
    verifyRemote(actual, asset);
  }
  if (!checked.htmlUrl.startsWith('https://github.com/' + repository + '/releases/')) {
    throw new ReleaseError('Unexpected Release URL');
  }
  return checked.htmlUrl;
}
