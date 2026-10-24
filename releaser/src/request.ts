import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../contracts/release-request.schema.json';
import { ReleaseError, type ReleaseRequest } from './types.js';

const validate = new Ajv2020({ allErrors: true }).compile(schema);

export function parseRequest(input: unknown): ReleaseRequest {
  if (!validate(input)) {
    throw new ReleaseError(
      'Invalid release request: ' +
        (validate.errors?.map((error) => error.message).join('; ') ?? ''),
    );
  }
  return input as unknown as ReleaseRequest;
}

export function tagFor(request: ReleaseRequest): string {
  // A nonstandard existing tag convention requires an explicit future adapter.
  return 'v' + request.version;
}

export function isPrerelease(version: string): boolean {
  return /(?:^|-)(?:alpha|beta|rc|pre|preview)\.?[0-9]*(?:[.-]|$)/i.test(version);
}
