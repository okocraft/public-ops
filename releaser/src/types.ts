export interface ReleaseRequest {
  readonly schema_version: 1;
  readonly repository: string;
  readonly version: string;
  readonly target_sha: string;
}
export interface ReleaseAsset {
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
}
export interface ReleaseManifest extends ReleaseRequest {
  readonly tag: string;
  readonly build_tool: 'gradle' | 'maven';
  readonly assets: readonly ReleaseAsset[];
}
export class ReleaseError extends Error {
  override readonly name = 'ReleaseError';
}
