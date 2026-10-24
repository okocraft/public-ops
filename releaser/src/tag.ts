const TAG = /^[0-9A-Za-z][0-9A-Za-z._-]*$/;

/**
 * Returns the tag for `version`, following the `v` prefix convention of `existingTags`
 * unless `override` is given. Fails if the tag already exists.
 */
export function resolveTag(
  version: string,
  existingTags: readonly string[],
  override?: string,
): string {
  const tag = override ?? `${inferPrefix(existingTags)}${version}`;
  if (!TAG.test(tag)) {
    throw new Error(`Invalid tag: ${JSON.stringify(tag)}`);
  }
  if (existingTags.includes(tag)) {
    throw new Error(`Tag ${tag} already exists`);
  }
  return tag;
}

function inferPrefix(existingTags: readonly string[]): "v" | "" {
  const prefixed = existingTags.some((tag) => /^v\d/.test(tag));
  const bare = existingTags.some((tag) => /^\d/.test(tag));
  if (prefixed && bare) {
    throw new Error("Existing tags mix `v1.0` and `1.0` styles; specify the tag explicitly");
  }
  return bare ? "" : "v";
}
