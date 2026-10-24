import { describe, expect, it } from 'vitest';
import { isPrerelease, parseRequest, tagFor } from '../src/request.js';

const valid = {
  schema_version: 1,
  repository: 'okocraft/Yaminabe',
  version: '0.1.0',
  target_sha: 'a'.repeat(40),
};

describe('release request validation', () => {
  it.each(['1.4', '0.1.0', '6.0.0-rc.4', '4.4-folia-1.20.4'])(
    'accepts the established %s release version',
    (version) => expect(parseRequest({ ...valid, version }).version).toBe(version),
  );
  it('rejects mutable refs and arbitrary build instructions', () => {
    expect(() => parseRequest({ ...valid, target_sha: 'main' })).toThrow();
    expect(() => parseRequest({ ...valid, command: 'rm -rf /' })).toThrow();
  });
  it('derives conventional tags and prerelease classification', () => {
    expect(tagFor(parseRequest(valid))).toBe('v0.1.0');
    expect(isPrerelease('6.0.0-rc.4')).toBe(true);
    expect(isPrerelease('4.4-folia-1.20.4')).toBe(false);
  });
});
