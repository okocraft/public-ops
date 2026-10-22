# Releaser

Status: **design and contracts only**. Nothing in this directory currently creates tags,
modifies target repositories, or publishes releases.

Releaser will accept an immutable release request for a specific repository, version,
and full commit SHA, run the relevant tests/build, and publish verified binaries to
the target repository's GitHub Release.

## Execution modes

| | Public target | Private target |
| --- | --- | --- |
| Workflow execution | Central workflow in `okocraft/public-ops` | Reusable workflow invoked **inside** the private target repository |
| Human approval | Required reviewer on the central `release` environment before publishing | None |
| Publishing identity | GitHub App installation token scoped to the target repository; minted only after approval | Target repository `GITHUB_TOKEN` |
| Build logs and artifacts | Public, so **public repositories only** | Remain private in the calling repository |
| Build source | Exact requested commit SHA | Exact requested commit SHA |

The two modes use the **same release contract and validation rules**; they differ in
where jobs run, which credentials they use, and whether publishing is approval-gated.

A private repository must **never** dispatch a build to the central public runner or
send its source, binary, build logs, or non-public metadata to public-ops. In the
private mode, public-ops supplies only pinned, reviewed reusable workflow code.

## Planned inputs

- [Release request JSON schema](contracts/release-request.schema.json): submitted
  by an AI agent or workflow to select the target repository, version, and commit.
- [Project configuration JSON schema](contracts/project-config.schema.json):
  checked into the **target repository** at `.github/releaser.json` to describe
  how its build produces the expected release assets.
- [Example release request](examples/release-request.json).
- [Example Gradle project configuration](examples/gradle-project-config.json).
- [Architecture and threat model](docs/architecture.md).

The release request is not itself an authorization to publish; Public publishing
requires a separate GitHub Environment approval. For Private targets, repository
write permissions govern who can trigger the workflow, with no review step.

## Scope and implementation stages

1. **This PR:** document the trust boundaries and versioned JSON contracts.
2. Core: validate inputs and source SHA, generate/check artifact manifest and
   checksums, create a draft Release, verify uploads, and publish safely.
3. Private: add Gradle and Maven reusable workflows, called from the target
   repository with minimal per-job permissions.
4. Public: add a central workflow, a required-reviewer environment gate,
   and target-scoped GitHub App credentials created **after** approval.
5. End-to-end verification, failure/retry coverage, and consumer setup docs.

Existing repository-specific publication (for example, Box's Maven/Javadoc hosting)
is outside the initial GitHub Release scope and must not be silently replaced.

## Non-goals of this PR

There is intentionally no executable publishing workflow, GitHub App configuration,
environment creation, branch protection change, or target-repository modification.
The JSON schemas define intended inputs; enforcement is implemented and tested in
the subsequent PRs.
