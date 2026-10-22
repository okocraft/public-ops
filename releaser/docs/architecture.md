# Releaser architecture and security invariants

## Objective and boundaries

An AI agent receives a request like "release okocraft/Yaminabe at 0.1.0".
It prepares a version-change PR and release notes, waits for required CI,
and identifies the merged commit. It submits a release request containing a
**full 40-character commit SHA**, not a mutable branch name. Automation
discovers the existing project's build and distributable binaries, validates
them, and publishes. AI-generated release requests are untrusted inputs.

A version bump, an Actions artifact, Maven publication, and a GitHub Release
are different operations. A successful build is not proof of a published
Release.

### Public targets

1. The agent uses the target's existing versioning/PR process.
2. The central public-ops workflow accepts a request for a **public**
   target and independently checks visibility through GitHub API; reject
   private targets, unsupported repositories, and conflicting tags.
3. A **non-privileged** job checks out the exact requested commit, discovers
   the Gradle/Maven build and version from that commit, builds/tests, and
   identifies and checks each deployable binary. It records asset filenames,
   byte lengths and SHA-256 checksums. It cannot access the publishing App key.
4. The publish job declares `environment: release` in **public-ops**.
   Required reviewers inspect repository, version, commit, CI result and
   artifact manifest. Disable self-review and administrative bypass.
5. **Only after approval**, the publish job gets a target-scoped GitHub
   App installation token, verifies the fixed request/manifest again,
   creates the tag and a draft Release, uploads verified assets, and publishes.
6. Verify the published Release URL, tag commit, and all required assets.

Environment protection settings, secrets, App installation and app permissions
are out-of-band repository/organization configuration, not created by a PR.
Restrict who can edit release workflows and approval settings.

### Private targets

1. The agent prepares the release inside the private target repository
   according to its existing authorization/CI rules. **No Releaser
   human-approval step is required.**
2. The private repository contains a **minimal GitHub Actions entry point**
   invoking a reviewed, SHA-pinned reusable workflow in public-ops. It does
   not need a project-specific Releaser configuration file or copied logic
   for Gradle/Maven/artifact paths.
3. Build and tests use read-only permissions; publishing receives
   `contents: write` from the caller's `GITHUB_TOKEN`, scoped to the
   **same private repository**. Fixed SHA and artifacts are revalidated.
4. All checkout, build, logs, temporary artifacts, and publishing remain
   **in the private repository's Actions run**. Never send private source,
   artifact bytes, commit IDs, logs, secrets or release requests into the
   public central workflow.

Reusable workflows run in the caller's workflow context; caller token
permissions are an upper bound, so restrict credentials per job. The
reusable-workflow source should be pinned by commit SHA and reviewed on
updates.

## Minimal release request contract

See [release-request.schema.json](../contracts/release-request.schema.json).
The request identifies target repository, requested version, and fixed
source commit. It does **not** contain build commands or asset paths.

The existing target repository supplies Gradle/Maven definitions and output
conventions, **not** a newly required `.github/releaser.json`. The
[discovery design](discovery.md) describes what may be inferred and when
discovery must fail. GitHub API, **not** the request, determines repository
visibility. Tag conventions are inferred from existing tags where unambiguous.

The initial request format accepts an existing release-style version such as
`1.4`, `0.1.0`, or `6.0.0-rc.4`. Strict effective version matching
and rejecting snapshots are later implementation responsibilities.

The build stage generates an **immutable artifact manifest** binding
repository, exact commit SHA, version, asset basename, size and SHA-256.
The publish job must consume and verify it without modification.

## Security and correctness requirements

- Strictly validate repository/version/SHA syntax. Never assemble shell
  commands or filesystem paths from untrusted request strings.
- Checkout by SHA and inspect effective Gradle/Maven version and packaged
  metadata. The source version must match the requested version.
- Do not upload every JAR recursively: discover distributable binaries
  according to explicit, tested rules and **fail closed** if ambiguous.
  Reject missing, empty, non-JAR, duplicate-named or conflicting assets.
- The privileged publishing job **must not execute target repository code**;
  use pinned and reviewed publishing implementation only. The GitHub App
  key is never accessible to unprivileged builds.
- Never force-move an existing tag. An existing tag or published Release
  must be compatible with the exact requested commit and artifacts.
  Only a compatible draft may be resumed with hashes checked; never
  silently overwrite a published asset.
- Serialize releases by target repository and resolved tag. Do not switch
  source SHA when the target branch advances after approval.
- Publish drafts only after all required assets and checksums have been
  attached and verified. Report URL, commit, asset listing and checksums
  as the success result.
- Private logs and build materials remain private **by design**, not via
  attempted secret masking. Public request and job logs may only contain
  public repository data.

## Workflow placement and credential boundaries

| Component | Runs in | Credential |
| --- | --- | --- |
| Public build | `public-ops` | Read-only |
| Public publish | `public-ops` after `release` environment approval | GitHub App token scoped to target |
| Private build | Calling private repo | Read-only `GITHUB_TOKEN` |
| Private publish | Calling private repo | `GITHUB_TOKEN` with `contents: write` |

A cross-repository dispatch from a public central workflow into a private
target is unnecessary for the initial design.

## Follow-on work

- PR 2: input validation, automated Gradle/Maven discovery, artifact hashing,
  GitHub Release draft/upload/publish, safe reruns.
- PR 3: private reusable workflows and minimal caller entry point.
- PR 4: public approval-gated orchestrator and GitHub App token handling.
- PR 5: E2E tests, failure scenarios, release instructions and org setup.
