const RELEASE_VERSION = /^\d+(?:\.\d+)+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;

/** Rejects anything that is not a release version such as `1.4`, `0.1.0` or `6.0.0-rc.4`. */
export function assertReleaseVersion(version: string): void {
  if (!RELEASE_VERSION.test(version) || /snapshot/i.test(version)) {
    throw new Error(`Invalid release version: ${JSON.stringify(version)}`);
  }
}

/** Extracts `version` from the output of `gradle properties`. */
export function parseGradleVersion(output: string): string {
  const match = /^version: (.+)$/m.exec(output);
  if (match?.[1] === undefined) {
    throw new Error("Could not find the project version in the Gradle properties output");
  }
  return match[1].trim();
}
