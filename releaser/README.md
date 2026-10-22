# Releaser

Status: **design and contracts only**. Nothing in this directory currently
creates tags, modifies target repositories, or publishes releases.

Releaser aims to turn a request such as "release okocraft/Yaminabe at 0.1.0"
into a tested GitHub Release with the expected binaries attached **without a
per-repository Releaser configuration file**.

The existing project's build definitions remain the source of truth.
Releaser discovers the build tool, version, and distribution artifacts; if it
cannot identify them safely, it fails instead of guessing or attaching all JARs.

## Execution modes

| | Public target | Private target |
| --- | --- | --- |
| Workflow execution | Central workflow in `okocraft/public-ops` | Reusable workflow invoked **inside** the private target repository |
| Human approval | Required reviewer on the central `release` environment before publishing | None |
| Publishing identity | GitHub App installation token scoped to the target repository; minted only after approval | Target repository `GITHUB_TOKEN` |
| Build logs and artifacts | Public: **public repositories only** | Remain private in the calling repository |
| Build source | Exact requested commit SHA | Exact requested commit SHA |
| Per-project Releaser config | **Not required** | **Not required** |

Both modes use the same release-request contract, artifact discovery/validation
rules, and publication safety checks. They differ only in execution location,
credential source, and approval requirements.

A private repository must **never** dispatch its build to a public-ops runner
or send its source, binary, logs, or non-public release metadata to public-ops.
It uses a **minimal workflow entry point** to invoke the pinned reusable workflow;
that entry point must not duplicate build commands or asset mappings.

## Inputs and discovery

- [Release request JSON schema](contracts/release-request.schema.json):
  repository, requested version, and immutable source commit SHA.
- [Example request](examples/release-request.json).
- [Build and artifact discovery design](docs/discovery.md): infer from Gradle
  wrapper/project files or Maven POMs and validate distributable JARs.
- [Architecture and threat model](docs/architecture.md).

There is intentionally **no `.github/releaser.json`** and no
`project-config.schema.json`. The AI or workflow specifies only the release
intent, not a list of binaries to publish.

## Implementation stages

1. **This PR:** document the execution/credential boundaries, release request
   contract, discovery strategy, and explicitly unsupported cases.
2. Core: strictly validate inputs/source SHA, resolve build/version and release
   artifacts, generate checksums, create a draft Release, verify uploaded assets,
   and publish with safe retries.
3. Private: Gradle and Maven reusable workflows running in the calling private
   repository with a minimal entry point and per-job permissions.
4. Public: central workflow, required-reviewer environment gate, App token
   scoped to the target repo, and public-visibility enforcement.
5. End-to-end tests, failure scenarios, and onboarding documentation.

Existing special-purpose publication, such as Box's Maven repository and
Javadocs, remains out of scope for the initial GitHub Release implementation.

## Non-goals of this PR

There is intentionally no executable publishing workflow, GitHub App setup,
Environment configuration, branch protection change, or modification to target
repositories. JSON Schema defines intended input structure; its enforcement
and functional discovery are implemented and tested in the follow-on PRs.
