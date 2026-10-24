const EXCLUDED = [/^original-/, /-(?:sources|javadoc|tests)\.jar$/];

/**
 * Picks the distributable JARs out of the file names in a build output directory.
 *
 * With `primaryJar` (Maven's `<finalName>.jar`), exactly one JAR is expected: the primary
 * JAR is dropped when another candidate exists, such as a shaded JAR written under its own
 * name (`shadedArtifactAttached` with a shade `finalName`).
 */
export function selectAssets(fileNames: readonly string[], primaryJar?: string): string[] {
  const candidates = fileNames
    .filter((name) => name.endsWith(".jar") && !EXCLUDED.some((pattern) => pattern.test(name)))
    .toSorted();
  if (candidates.length === 0) {
    throw new Error("No distributable JAR found in the build output");
  }
  if (primaryJar === undefined) {
    return candidates;
  }
  const others = candidates.filter((name) => name !== primaryJar);
  const assets = others.length === 0 ? candidates : others;
  if (assets.length !== 1) {
    throw new Error(`Cannot choose the distributable JAR among ${assets.join(", ")}`);
  }
  return assets;
}
