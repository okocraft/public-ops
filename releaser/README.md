# Releaser

Status: private repositories are supported; the public workflow is not implemented yet.

Releaser turns "release okocraft/Hugs at 1.5" into a GitHub Release with the
built binaries attached. Target repositories need **no Releaser configuration
file**: the existing Gradle or Maven build is the source of truth.

## How a release works

1. The version bump is merged through the target repository's normal PR flow.
   Releaser does not change versions.
2. The release workflow is started with a version (and optionally a ref).
3. The **build** job checks out the ref, resolves it to a commit SHA, builds
   the project, verifies the effective project version equals the requested
   version, and selects the binaries to attach.
4. The **publish** job creates the tag at that exact SHA and a GitHub Release
   with auto-generated notes and the selected binaries (`gh release create`).
   It never runs target repository code.

An existing tag or release for the version is an error; nothing is overwritten.

## Execution modes

|                      | Public target                                                | Private target                                                  |
| -------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| Runs in              | `okocraft/public-ops` (`release-public.yml`)                 | The private repository, via the reusable workflow `release.yml` |
| Approval             | Required reviewers on the `release` environment              | None                                                            |
| Publish credential   | GitHub App token scoped to the target, minted after approval | The repository's `GITHUB_TOKEN` (`contents: write`)             |
| Per-repository setup | None                                                         | A small caller workflow                                         |

Private source, logs and binaries never leave the private repository's run.

## Private repository setup

Add `.github/workflows/release.yml` to the private repository, pinning a
public-ops release by SHA (Renovate keeps it up to date):

```yaml
name: Release
on:
  workflow_dispatch:
    inputs:
      version:
        description: Version to release
        required: true

jobs:
  release:
    uses: okocraft/public-ops/.github/workflows/release.yml@<sha> # <public-ops version>
    with:
      version: ${{ inputs.version }}
    permissions:
      contents: write
```

Start it with `gh workflow run release.yml -R okocraft/<repo> -f version=<version>`.
Optional inputs: `ref` (default: the triggering ref), `tag` and `java-version`.
The reusable workflow checks out its own releaser code at the same commit
(`job.workflow_sha`), so the pinned SHA fixes both.

## Discovery rules

- **Build tool:** Gradle wrapper (`gradlew`) or `pom.xml`. Both or neither fails.
- **Version:** Gradle `./gradlew properties` / Maven `help:evaluate` for
  `project.version`. It must equal the requested version.
- **Binaries:**
  - Gradle: `build/libs/*.jar` in the root project (where the `bundler`
    plugin's `copyToRootBuildDirectory` collects distributables).
  - Maven: `target/*.jar`, excluding `original-*` (shade) and the `sources`,
    `javadoc` and `tests` classifiers. Exactly one JAR must remain; the plain
    `<finalName>.jar` is dropped when a shaded JAR is written under another name.
  - No candidates fails the release.
- **Tag:** follows the repository's existing tags (`v1.2.3` or `1.2.3`);
  `v<version>` when there are no tags. It can be overridden by an input.
- **Java:** `25` by default, overridable by an input.

## Implementation

TypeScript run directly by Node.js 24 (type stripping, no bundled `dist`),
with no runtime dependencies. Development uses pnpm, `tsc` for type checking,
`node --test`, oxlint and oxfmt.

`src/prepare.ts` runs in the target checkout: it verifies the version,
resolves the tag, builds, and copies the binaries to `--out-dir`.

```sh
cd releaser
pnpm install
pnpm run check   # oxfmt --check, oxlint, tsc, node --test
```

Planned: the public workflow with environment approval and GitHub App token.

Out of scope: Maven repository publishing, Javadocs and multi-module Maven
projects.
