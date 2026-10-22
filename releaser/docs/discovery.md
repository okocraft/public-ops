# Zero-config build and release artifact discovery

## Goal

A target repository should **not** need `.github/releaser.json`, custom
Releaser build tasks, or manually maintained binary paths. The existing Gradle
or Maven build configuration is authoritative. The AI sends only the release
request (repository, version and immutable full commit SHA). The automation
must refuse publication when it cannot positively identify the distributable
artifacts.

No arbitrary path list or shell command supplied by an AI is trusted.

## Build tool and runtime detection

- **Gradle:** detect a Gradle wrapper plus `settings.gradle[.kts]` or
  `build.gradle[.kts]`. Use the repository's wrapper and normal `build`
  lifecycle at the pinned commit.
- **Maven:** detect `pom.xml`; prefer a checked-in Maven wrapper if present,
  otherwise run Maven's `package` lifecycle.
- **Both or neither:** fail with a diagnostic; do not choose based on a guess.
- **Java version:** prefer existing build toolchains/compile configuration or
  project CI setup where it can be reliably resolved; an organization-wide
  default may support simple projects but must not silently override a
  conflicting explicit requirement. If the runtime cannot be selected safely,
  fail before building.
- **Requested version:** verify against Gradle's effective `project.version`
  or Maven's effective `project.version` (including multimodule consistency).
  A mismatch is a hard failure. `-SNAPSHOT` inputs must never be published as
  stable releases.

## Distribution asset detection

**Do not upload every JAR under `**/build/libs` or `**/target`.**
A successful build can produce library modules, plain/unshaded JARs, test
fixtures, developer JARs, source and Javadoc archives in addition to actual
plugin binaries.

Initial detection order:

1. Look for distribution JARs collected in Gradle's root `build/libs`.
   Yaminabe and Kansokusha already configure their `bundler` plugin to copy
   Paper and Velocity distributables there; these are the expected first
   adoption targets. Check each JAR's name and embedded plugin metadata,
   reject duplicate, empty, missing-version, or non-distribution candidates.
2. For Maven, inspect effective module packaging and packaged artifact paths
   (e.g. `target/`) plus JAR/plugin metadata. Exclude test/source/Javadoc and
   auxiliary classifiers. Prefer uniquely identifiable deployable artifacts
   over unclassified intermediate JARs.
3. Consult existing Gradle task outputs/Maven project metadata only if the
   primary convention is insufficient; do not run arbitrary text fragments
   extracted from build files as shell commands.
4. If zero candidates, overlapping candidates, multiple mutually inconsistent
   versions, or any ambiguity remains, **fail closed** with an actionable
   diagnostic rather than publishing a partial or unexpected Release.

Every candidate must be a valid readable archive and carry suitable plugin
metadata for the detected distribution type (for example
`paper-plugin.yml`, `plugin.yml`, or `velocity-plugin.json`; the exact
checks will be tested against real repositories). Require version consistency
with the request. Generate a build manifest binding repository, commit SHA,
version, asset filename, byte size and SHA-256 checksum. The publish job must
verify this manifest and the asset bytes before publication.

Avoid renaming binaries unless preserving plugin conventions requires it.
Collision of basenames across modules is an error, not silent replacement.

## Release tags and exceptional repositories

Discover established release tag prefixes and format from the target
repository's **existing tag history**, where unambiguous. For a new repository
without a tag convention, the initial default is `v<version>`. Never
force-update a conflicting existing tag or published Release. An ambiguous
tag convention must fail with an explicit reason.

Zero-config discovery does not mean every arbitrary build can be correctly
inferred. Repositories with nonstandard output layout or custom deployment
requirements may need a future centrally maintained adapter **or an explicit,
validated request-time override**. Neither should require adding a permanent
project configuration file to every repository. Any private-repo override
must remain in the private execution context, not be sent to a public runner.

## Required test fixtures for implementation

- Yaminabe and Kansokusha: Gradle multimodule Paper + Velocity distributables
  collected in root `build/libs`, not intermediate `common` JARs.
- Hugs: Maven's version and distributable artifact derived from `pom.xml`.
  Existing versions such as `1.4` must not be rejected solely for lacking
  a patch component.
- Extra `-plain`, `-sources`, `-javadoc`, and test-fixture JARs: exclude
  or fail safely, rather than publishing these as release binaries.
- Empty or missing JAR, invalid plugin metadata, version mismatch, duplicate
  basename, ambiguous release tag style, and already published Release: fail.
- Private caller: no private names, file paths, logs, binaries, or secrets
  appear in the Public `public-ops` Actions run.
