const EXCLUDED = [/^original-/, /-(?:sources|javadoc|tests)\.jar$/];

/** Picks the distributable JARs out of the file names in a build output directory. */
export function selectAssets(fileNames: readonly string[]): string[] {
  const assets = fileNames
    .filter((name) => name.endsWith(".jar") && !EXCLUDED.some((pattern) => pattern.test(name)))
    .toSorted();
  if (assets.length === 0) {
    throw new Error("No distributable JAR found in the build output");
  }
  return assets;
}
