# Releaser architecture and security invariants

## Objective and boundaries

An AI agent receives a request like "release okocraft/Yaminabe at 0.1.0".
It prepares the version-change PR and release notes, waits for successful required CI,
and identifies the merged commit. It then submits a release request containing a **full
40-character commit SHA**, not a mutable branch name. Release automation performs
deterministic validation, builds, and publishes. AI output is untrusted input.

Do not assume that merging a version bump, uploading an Actions artifact, publishing
to Maven, and publishing a GitHub Release are equivalent operations.

### Public targets

1. An agent prepares a change through the target repository's normal PR and CI flow.
2. The central public-ops workflow accepts a request for a **public** target and
   independently confirms its visibility via GitHub API. Reject private targets,
   repositories outside the configured allowlist, and unsupported ref/version formats.
3. A **non-privileged** job checks out the fixed commit, obtains configuration from
   that same commit, builds/tests, and records the exact asset names, sizes and SHA-256
   values. It cannot access the publishing App key or write token.
4. A publishing job declares `environment: release` in **public-ops**. Its required
   reviewers inspect the intended repository, version, commit, build result, and asset
   manifest. Self-review and administrative bypass should be disabled.
5. **After** environment approval, that job gets a target-repository-scoped
   GitHub App installation token. It validates the immutable request/manifest
   again, verifies that the tag and Release are safe to create, then creates a
   draft Release, uploads verified assets, and publishes.
6. Verify the published Release URL, target commit and all required assets. A
   workflow run is not successful merely because the build or API call succeeded.

GitHub Environment settings, secrets, and the App installation are **manual,
out-of-band repository/organization configuration**. They are not established
by a pull request. Restrict who can modify the workflow and approval policy.

### Private targets

1. The AI agent prepares the release in the private target repo under its normal
   authorization and CI rules; there is **no Releaser human-approval requirement**.
2. The private repo invokes a reusable workflow from a **pinned commit SHA**
   of `okocraft/public-ops`. The caller owns the Actions run, logs, temporary
   build artifacts, and Release.
3. Build/test jobs have read-only permissions. The publishing job has
   `contents: write` for the **same private repository** and uses that caller's
   `GITHUB_TOKEN`. It checks the exact SHA and assets before publication.
4. Never forward source code, artifacts, workflow logs, repository secrets,
   private commit IDs or private release requests to a public central workflow.
   No central public-ops job checks out a private repository.

A reusable workflow is source code, not a remote execution service: its jobs execute
under the calling repository's Actions context. A caller's permissions are a ceiling,
and the called workflow must reduce permissions per job where possible. Changing
the workflow implementation must go through review, and callers should pin it by SHA.

### Approval differences

Public: approval happens **after successful build**, immediately before creating
a write-capable App token. The approval authorizes that immutable request and
artifact manifest; the publishing job must reject changes to either.

Private: there is **no approval gate**. The principal allowed to start a release
must already have suitable write access in the target repository. Existing branch
protections remain authoritative; an agent must not bypass them.

## Contract ownership

- The agent supplies the [release request](../contracts/release-request.schema.json):
  version, repository, and fixed source commit SHA.
- A trusted revision of the **target repo** supplies `.github/releaser.json` matching
  the [project configuration](../contracts/project-config.schema.json). It specifies
  build tool, argument vector, Java version, exact expected asset paths/names, and
  tag prefix. Configuration must be read from the **requested commit**, not HEAD.
- GitHub API, **not the request**, determines repository visibility.
- The artifact manifest is generated *by the build/verification job*, not from
  an AI-supplied manifest. It binds repository, SHA, version, asset name, size, and
  SHA-256; build and publish stages transfer it without editing it.

The initial supported version format is SemVer 2.x (for example `0.1.0` or
`1.3.0-rc.1`); tag prefixes are configured per project (typically `v`).
Legacy version/tag formats can be added explicitly in a later contract version.

## Security and correctness requirements

- Reject versions, repository names, or paths that violate the strict schemas.
  Never construct or execute arbitrary shell commands from request JSON.
  Build arguments are passed as argument vectors, not interpolated into shell.
- Repository checkout must be by full SHA, and the configured version in the
  built source must equal the requested version; inspect packaged plugin metadata
  for Java plugin distributions.
- Verify every configured asset exists, is nonempty, has a unique safe basename,
  and matches its expected filename. Fail closed if any are missing or duplicated.
  Do not upload arbitrary globs, test reports, unsigned extra files, or source
  directories as release binaries. Generate and check SHA-256 checksums.
- The publish job **must not execute code from the target checkout**. Use pinned
  actions/reviewed release implementation and verify transferred bytes. Do not
  pass App credentials into build jobs.
- **Immutable tags:** never force-move an existing tag. Fail if an existing tag
  resolves to a different commit, or an existing published Release disagrees with
  the request. Resume only a compatible draft from the same commit and recheck
  already uploaded asset hashes; never silently overwrite published assets.
- Use concurrency keyed on the target repository plus tag, and reject conflicting
  requests. Keep the request SHA fixed even when the default branch advances.
- Publish drafts only after all configured assets and checksums have been attached
  and verified; provide an auditable Release URL and asset manifest on success.
- Private logs should remain private by design, not by relying on secret masking.
  Public requests and CI logs must contain only information safe to disclose.

## Workflow placement and credential boundaries

| Component | Runs in | Repository credential |
| --- | --- | --- |
| Public prepare/build | `public-ops` | Read-only (no release secrets) |
| Public publish | `public-ops` after `release` environment approval | GitHub App token, scoped to the target public repo |
| Private prepare/build | Calling private repo | Read-only `GITHUB_TOKEN` |
| Private publish | Calling private repo | Caller `GITHUB_TOKEN` with `contents: write` |

A public-ops workflow that invokes `workflow_dispatch` against a private target
would be an additional cross-repo orchestration layer and is **not required** by the
base design.

## Follow-on work

- PR 2: schema validation implementation, build/asset safety checks, hashing,
  GitHub Release draft/upload/publish and idempotent failure handling.
- PR 3: private reusable workflow for Gradle/Maven with correct isolated jobs,
  build inputs and per-job token permissions.
- PR 4: public dispatch/orchestrator, environment-gated publication,
  GitHub App token setup and allowlist/visibility enforcement.
- PR 5: E2E tests, security failure cases, integration documentation and
  GitHub organization setup instructions.
