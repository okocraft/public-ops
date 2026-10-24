# Releaser core CLI (PR 2)

The core is implemented with the Python standard library. **No target repository
needs a Releaser config file.** This is a standalone library and CLI for later
GitHub Actions integration; it is **not yet automatically invoked by a workflow**.

## Release request

The agent generates a file matching
[release-request.schema.json](../contracts/release-request.schema.json):

```json
{
  "schema_version": 1,
  "repository": "okocraft/Yaminabe",
  "version": "0.1.0",
  "target_sha": "0123456789abcdef0123456789abcdef01234567"
}
```

The SHA must be the full commit ID of the version-bumped project. A branch name
is never an acceptable substitute.

## Prepare (unprivileged build job)

A workflow checks out **that SHA** of the target project, installs an
appropriate Java toolchain, and performs the normal project build. After
successful tests, it executes:

```shell
python3 releaser/core/cli.py validate-request --request request.json
python3 releaser/core/cli.py prepare \
  --request request.json \
  --workspace /path/to/target/checkout \
  --bundle /path/to/output/release-bundle
```

The CLI verifies the checkout HEAD SHA, source version, and metadata of
distributable plugin binaries, copies only accepted files, and writes
`release-bundle/manifest.json` and `checksums.txt`.

The resulting bundle is an **untrusted transfer artifact** until the separate
publishing job validates all its sizes/hashes again. The publishing job must
not execute Gradle, Maven, or any scripts from the target checkout.

## Publish (privileged job)

Following the environment approval for **Public** targets (or automatically
within a **Private** caller), a publishing job downloads the exact prepared
bundle and uses the appropriately scoped token:

```shell
python3 releaser/core/cli.py verify-bundle --bundle release-bundle
GH_TOKEN="$GITHUB_APP_INSTALLATION_TOKEN" \
  python3 releaser/core/cli.py publish --bundle release-bundle
```

The `publish` command validates the target commit and tag, creates a draft
GitHub Release, uploads each checked asset and checksums file, verifies their
GitHub-computed SHA-256 digests, publishes and verifies the Release.

### Security requirements for Actions integration

- The publishing job **must not** get tokens before Public Environment approval.
- Public jobs independently verify the target repository's visibility.
- Set job `concurrency` to a stable per-target/per-tag key to prevent races.
- Build jobs use `contents: read`; publishing uses scoped write access.
- Pin the Releaser code revision; do not run target-supplied build scripts in
  the publishing job.
- Do not forward private source/artifacts/logs into Public Actions.
- Authenticated Release Assets require GitHub API to supply a `digest`;
  absence of that field fails closed.
- The default tag style in this initial core is `v<version>`. Existing
  nonstandard tag conventions require explicit detection in later work.
- A successfully published Release is immutable to the core: retrying that
  version fails instead of changing assets.

### Supported builds and limits

This first implementation supports Gradle projects whose `version` is
explicit in `gradle.properties` and whose deployable plugin jars are copied
to root `build/libs`, plus simple Maven projects with a directly resolvable
`pom.xml` version and jars in root or one-level `target` directories.

Only JARs with Paper/Bukkit or Velocity plugin metadata matching the requested
version are selected. It does not assume all JARs are releasable. There is a
per-file 256 MiB cap, up to 20 binary assets, and strict duplicate/missing
platform detection. Exotic build conventions and non-plugin libraries are not
yet supported; the core fails closed rather than guessing.

## Tests

```shell
python3 -m unittest discover -s releaser/tests -v
```

The unit tests use temporary JARs and a fake GitHub API. They create **no
real releases, refs, or repository modifications**.

The Public approval-gated orchestrator and Private reusable workflow are
separate follow-up PRs.
