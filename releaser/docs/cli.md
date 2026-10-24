# TypeScript Releaser core

The implementation uses TypeScript (strict typechecking), Node.js 24, GitHub Actions
Toolkit, Octokit, Ajv, Vitest, ESLint, Prettier and esbuild.

**No per-repository Releaser settings are required.** Workflow orchestration is
intentionally a separate PR. This PR does not trigger real GitHub Releases.

## Prepare Action (read-only)

`releaser/actions/prepare/action.yml` accepts:

- `request-file`: JSON request matching `releaser/contracts/release-request.schema.json`
- `workspace`: source directory checked out at exactly the request's `target_sha`
- `bundle-directory`: new directory that does not exist yet

Caller builds/tests the source with its existing Gradle wrapper or Maven build,
then runs Prepare without any publication credentials. Prepare verifies source
SHA and version, opens JAR metadata with bounded ZIP parsing, selects only
deployable Paper/Bukkit and Velocity JARs, and stages:

- Release binaries (exact original filenames)
- `checksums.txt`
- `manifest.json` binding repository, commit SHA, version, asset sizes/hashes

If discovery cannot positively identify the intended artifacts, Prepare fails.
The first release core supports Gradle root `build/libs` and Maven root or
module `target` layout, with explicit Gradle `gradle.properties` versions
and directly resolvable Maven POM versions. Other layouts may require further
discovery logic. No arbitrary AI-provided shell command or binary mapping is
accepted.

## Publish Action (write permission only after Public approval)

`releaser/actions/publish/action.yml` accepts:

- `bundle-directory`: the previously staged release bundle
- `mode`: `public` or `private`, checked against the repository visibility
- `token`: a target-scoped write token; GitHub App for Public after central
  Environment approval; caller `GITHUB_TOKEN` for Private

The publishing job must **not** check out or execute target repository code.
It rehashes all transferred assets, verifies the target repository and source
SHA via GitHub, checks existing tags/releases, uploads to a Draft Release,
checks remote SHA-256 digests and expected asset names, then publishes and
re-verifies. An already published Release is not modified, and a conflicting
tag/draft asset is never overwritten.

For Private mode, the Action additionally checks that `GITHUB_REPOSITORY`
identifies the same repository; private build logs and binaries never enter a
public GitHub Actions execution.

## Development

```shell
cd releaser
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm test
npm run format:check
npm run build:check
```

The checked-in `actions/{prepare,publish}/dist/index.js` are deterministic
esbuild bundles. Update them with `npm run build` and commit the regenerated
files with any source changes. Consumers of the JavaScript Actions do not
need to install npm dependencies.

## Integration constraints

- Pin any reused workflow or JavaScript Action to a reviewed SHA.
- Use per-job permissions; do not make the GitHub App key available to the
  Prepare job.
- Run Public publication behind `environment: release` with required
  maintainer reviewers.
- Run Private Actions in the calling repository, without human approval.
- Apply workflow-level per-target/per-tag concurrency to prevent races.
- Initial tag format is `v<version>`. Nonstandard historical tags will need
  an explicit adapter. Other publication channels such as Maven/Javadocs are
  out of scope.
