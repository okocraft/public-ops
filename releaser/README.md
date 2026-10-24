# Releaser

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

## Public repositories

Run `release-public.yml` in public-ops:

```sh
gh workflow run release-public.yml -R okocraft/public-ops -f repository=<repo> -f version=<version>
```

Optional inputs: `ref` (default: the default branch), `tag`, `java-version` and `notes`.
The build job rejects non-public repositories and lists the assets with
SHA-256 checksums in the run summary. The publish job waits for approval on
the `release` environment, then mints a token for the target repository only.

One-time setup (outside this repository's code):

1. Create a GitHub App with repository permission **Contents: Read and write**
   and install it on the okocraft public repositories to release.
2. In public-ops, create the `release` environment with required reviewers
   (prevent self-review, disallow administrators bypassing) and restrict it
   to the `main` branch.
3. Add to the `release` environment the variable `RELEASER_APP_CLIENT_ID`
   and the secret `RELEASER_APP_PRIVATE_KEY`.

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
Optional inputs: `ref` (default: the triggering ref), `tag`, `java-version` and `notes`.
The reusable workflow checks out its own releaser code at the same commit
(`job.workflow_sha`), so the pinned SHA fixes both.

## Releasing with an agent

Give [RUNBOOK.md](RUNBOOK.md) to the agent with the repository to release.
It covers the change review, version choice, test checklist, release notes,
the version bump PR, running the workflow and verifying the result.
Without `notes`, GitHub generates a list of merged PRs instead.

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

Out of scope: Maven repository publishing, Javadocs and multi-module Maven
projects.
