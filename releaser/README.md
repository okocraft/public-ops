# Releaser

The **TypeScript release core** is implemented with GitHub Actions Toolkit,
Octokit, strict input validation, JAR discovery and SHA-256 verification.
[Core usage and limits](docs/cli.md) · [Architecture](docs/architecture.md) ·
[Discovery specification](docs/discovery.md).

This PR does **not** wire up automatic releases. Public and Private workflow
integration and GitHub App / Environment configuration are separate PRs.

## Zero-configuration release contract

An AI agent supplies the target repository, requested version and full commit
SHA matching [the release-request schema](contracts/release-request.schema.json).
Gradle or Maven project files remain the source of truth: no
`.github/releaser.json`, duplicate build setup or custom list of JARs is required.

If the release binaries cannot be safely identified, preparation fails rather
than publishing an ambiguous or incomplete Release.

## Public and private execution

| | Public | Private |
|---|---|---|
| Job execution | Central `public-ops` workflow | In target private repository |
| Maintainer approval | Required, via central `release` Environment | Not required |
| Build credentials | Read only | Read only |
| Publish credentials | Target-scoped GitHub App token after approval | Caller `GITHUB_TOKEN` |
| Logs and build artifacts | Public only | Remain private |
| Shared implementation | TypeScript Prepare / Publish JavaScript Actions | Same actions |

Release publication consists of a verified immutable tag, Draft Release,
verified asset uploads and final publication. The current core supports
standard Paper/Bukkit and Velocity plugin JARs built using Gradle or Maven.

## Implementation plan

1. Architecture / immutable request contract — merged.
2. **This PR:** TypeScript core, zero-config detection, checked-in bundles,
   tests and CI.
3. Private reusable workflows, with minimal caller workflow entry points.
4. Public approval-gated workflow and scoped GitHub App integration.
5. End-to-end integration tests and onboarding instructions.

Existing non-GitHub publication (e.g. Maven/Javadocs) remains separate.
