# Release runbook for agents

Give this file to an AI agent together with a request such as
"Release okocraft/Hugs". It covers one release of one repository.

## Goal

Publish a GitHub Release of the requested repository at a verified version,
with the correct binaries and release notes, through the Releaser workflows.
A human approves the release twice: by merging the version bump PR, and, for
public repositories, by approving the `release` environment.

## Inputs

- **Repository** (required): `okocraft/<name>`.
- **Version** (optional): if omitted, propose one in Step 3.
- **Ref** (optional): the branch to release from. Default: the default branch.

## How Releaser works

Releaser builds the repository with its existing Gradle or Maven setup and
publishes a GitHub Release. Target repositories need no Releaser config file.

|                | Public repository                                         | Private repository                                                                   |
| -------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Workflow       | `release-public.yml` in `okocraft/public-ops`             | `.github/workflows/release.yml` in the repository, calling public-ops' `release.yml` |
| Approval       | A maintainer approves the `release` environment           | None                                                                                 |
| Publishing     | GitHub App token scoped to the repository, after approval | The repository's `GITHUB_TOKEN`                                                      |
| Per-repo setup | None                                                      | The caller workflow (see Step 1)                                                     |

Both workflows have a **build** job (checks out `ref`, verifies the version,
builds, selects binaries) and a **publish** job (creates the tag at the
built SHA and the release with `gh release create`). Private source, logs
and binaries never leave the private repository's Actions run.

Workflow inputs:

| Input          | Required | Meaning                                                            |
| -------------- | -------- | ------------------------------------------------------------------ |
| `repository`   | public   | Repository name under okocraft, e.g. `Hugs`.                       |
| `version`      | yes      | Must equal the project version at `ref`; no `-SNAPSHOT`.           |
| `ref`          | no       | Branch, tag or SHA to release. Default: default/triggering branch. |
| `tag`          | no       | Tag name. Default: inferred, see below.                            |
| `java-version` | no       | Default `25`.                                                      |
| `notes`        | no       | Release notes (Markdown). Default: GitHub-generated list of PRs.   |

For a private repository you start its caller workflow, which forwards
`version`, `ref` and `notes` to the reusable workflow.

### Discovery rules

The build job fails instead of guessing when these do not hold:

- **Build tool:** Gradle wrapper (`gradlew`) or `pom.xml`, not both.
- **Version:** Gradle `./gradlew properties` / Maven `help:evaluate`
  `project.version` must equal `version`.
- **Binaries:**
  - Gradle: `build/libs/*.jar` of the root project (where the `bundler`
    plugin's `copyToRootBuildDirectory` collects distributables).
  - Maven: `target/*.jar` without `original-*` and the `sources`, `javadoc`
    and `tests` classifiers. Exactly one JAR must remain; the plain
    `<finalName>.jar` is dropped when a shaded JAR has another name.
- **Tag:** follows existing tags (`v1.2.3` or `1.2.3`); `v<version>` when
  there are none. An existing tag is an error.

## Rules

Follow these in every step. If a rule conflicts with the request, stop and ask.

- Never merge a PR, approve an environment, or push to the default branch.
- Never create, edit or delete tags or releases yourself. Only the Releaser
  workflows create them; if one needs fixing or deleting, ask the human.
- Never re-run a failed release workflow before you understand the failure.
- Never change build files except the version line in Step 5.
- Base every statement on evidence you read (commits, diffs, files, CI
  results). If you could not check something, say so; do not guess.
- When a step's completion criteria cannot be met, stop and report what is
  missing instead of continuing.
- Report to the human in the language of their request.

Stop and ask the human when:

- the version is ambiguous (for example a possible breaking change),
- CI on the commit to release is failing or missing,
- there is nothing to release since the previous release,
- the build tool, version location or binaries do not match the
  [discovery rules](#discovery-rules).

## Step 1: Collect facts

Tasks:

1. Clone the repository and fetch tags: `git clone https://github.com/okocraft/<name>`
   then `git fetch --tags`.
2. Record the default branch, visibility
   (`gh repo view okocraft/<name> --json defaultBranchRef,visibility`),
   build tool (`gradlew` or `pom.xml`) and the file holding the version
   (`gradle.properties` or `pom.xml`).
3. Find the previous release: `gh release list -R okocraft/<name> --limit 1`
   and its tag commit. If there is none, this is the first release.
4. Record the current version in the source and the commit SHA to release
   (head of the ref).
5. Private repository only: check that `.github/workflows/release.yml`
   exists on the default branch. If it does not, open a PR adding it (title
   `ci: add release workflow using okocraft/public-ops`), pinned to the
   latest public-ops release: get the tag with
   `gh release view -R okocraft/public-ops --json tagName` and its commit
   with `git ls-remote https://github.com/okocraft/public-ops 'refs/tags/<tag>*'`
   (use the `^{}` line if present). Ask the human to merge it.

   ```yaml
   name: Release
   on:
     workflow_dispatch:
       inputs:
         version:
           description: Version to release
           required: true
         ref:
           description: Branch, tag or SHA to release
           default: ""
         notes:
           description: Release notes in Markdown
           default: ""

   jobs:
     release:
       uses: okocraft/public-ops/.github/workflows/release.yml@<sha> # <tag>
       with:
         version: ${{ inputs.version }}
         ref: ${{ inputs.ref }}
         notes: ${{ inputs.notes }}
       permissions:
         contents: write
   ```

   If the existing caller workflow lacks the `ref` or `notes` input, include
   adding them in the same kind of PR.

Done when you have: default branch, visibility, build tool, version file,
previous tag (or "none"), current source version and commit SHA, and, for a
private repository, a merged caller workflow with `version`, `ref` and
`notes` inputs.

## Step 2: Review the changes

Tasks:

1. List commits since the previous tag: `git log --oneline <prev-tag>..<sha>`
   (all commits for a first release).
2. List the PRs merged since the previous release and read their
   descriptions:
   `gh pr list -R okocraft/<name> --state merged --search "merged:>=<prev-tag-date>" --limit 100`
   (`<prev-tag-date>` from `git log -1 --format=%cs <prev-tag>`).
3. Read the diff: `git diff --stat <prev-tag>..<sha>`, then the full diff of
   every file outside tests, CI and docs. Pay attention to `plugin.yml`,
   `paper-plugin.yml`, `velocity-plugin.json`, default config files,
   permissions, commands, and Minecraft/Java/dependency versions.
4. Classify each change as exactly one of: `breaking`, `added`, `changed`,
   `fixed`, `internal` (refactoring, CI, tests, routine dependency updates).
   A dependency update is not `internal` when it changes the supported
   server or Java versions.
   Exception: raising the required Java version (for example 21 → 25) is
   `changed`, not `breaking`. It does not raise the major version, but the
   notes must still state it (`- Require Java 25.` under `Changed`).

Done when every commit in the range is accounted for in a table of
change, classification and evidence (commit or PR).

## Step 3: Decide the version

Tasks:

1. If a version was given, check it against the classification. Otherwise
   propose one: increase the first number for `breaking`, the second for
   `added`, the last for only `changed`/`fixed`, keeping the existing
   number of components (`1.4` → `1.5`, `0.1.0` → `0.1.1`).
2. Check that the version is greater than the previous release, has no
   `-SNAPSHOT`, and that no tag for it exists yet.

Done when the version satisfies all checks in task 2. If you proposed it,
include the reasoning in the PR of Step 5; the human confirms it by merging.

## Step 4: Prepare verification and notes

Tasks:

1. Check CI on the commit to release:
   `gh run list -R okocraft/<name> --commit <sha>`. All runs must succeed.
2. Write a manual test checklist for the human, one item per user-facing
   change: what to do on a test server and the expected result. Add the
   standard items: the plugin loads without errors on the supported server
   software, and existing configuration still loads. Omit `internal` changes.
3. Write the release notes:
   - English, short and plain. Readers are server operators, not developers.
   - Only what users need: new features, behaviour changes, fixes they would
     notice, and required actions (config, permissions, supported
     Minecraft/Java versions).
   - Leave out `internal` changes.
   - One line per item, starting with a verb. Use only the sections that
     have items, in this order: `Breaking changes`, `Added`, `Changed`,
     `Fixed`.
   - No PR lists, author credits or changelog links.
   - First release: start with `Initial release.` and list the supported
     server software and Java version.
   - If nothing is user-facing: `Maintenance release with no user-facing changes.`

Example:

```markdown
### Breaking changes

- Require Paper 26.3 or later.

### Added

- Add `/example toggle` to disable the feature per player.

### Fixed

- Fix messages not being sent across worlds.
```

Done when CI is green on the SHA, every user-facing change has a test item
and a note line (or the note says there is none), and the notes follow every
rule above.

## Step 5: Open the version bump PR

Tasks:

1. If the source version already equals the target version, do not open a
   PR: show the human the same content as the PR body below and wait for
   explicit approval instead.
2. On a new branch from the commit to release, change only the version line
   (`version=` in `gradle.properties`, or the project `<version>` in
   `pom.xml`). Commit as `chore: release <version>`.
3. Open a PR titled `chore: release <version>` with this body:

   ````markdown
   ## Version

   <version> (previous: <prev-tag or none>). <Reasoning if you proposed it.>

   ## Changes

   <the table from Step 2>

   ## Manual test checklist

   - [ ] <items from Step 4>

   ## Release notes

   ```markdown
   <notes from Step 4>
   ```
   ````

4. Wait for CI on the PR to pass, then ask the human to test, edit the notes
   if needed, and merge.

Done when the PR is merged by a human (or the human approved in task 1).
Do not continue before that.

## Step 6: Run the release

Tasks:

1. Get the merge commit SHA from the merged PR (or the SHA from Step 1 if
   Step 5 was skipped). Confirm the version in the source at that SHA.
2. Copy the release notes from the **merged** PR body (the human may have
   edited them) into `notes.md`, without the surrounding code fence.
3. Start the workflow with that SHA:
   - Public repository:

     ```sh
     gh workflow run release-public.yml -R okocraft/public-ops \
       -f repository=<name> -f version=<version> -f ref=<sha> -f notes="$(cat notes.md)"
     ```

     Then tell the human that the `publish` job is waiting for approval and
     link the run. The run summary shows the tag, SHA, checksums and notes.
     The person who started the run cannot approve it; another maintainer
     must.

   - Private repository (caller workflow from Step 1):

     ```sh
     gh workflow run release.yml -R okocraft/<name> \
       -f version=<version> -f ref=<sha> -f notes="$(cat notes.md)"
     ```

4. Find the run (`gh run list -R <repo-running-it> --workflow <file> --limit 1`)
   and wait for it: `gh run watch <run-id> -R <repo-running-it>`.

Done when the run has completed successfully. If it failed, read the failed
job log (`gh run view <run-id> --log-failed`), report the cause, and stop.
For a public repository, a failure to create the App token usually means
the one-time setup below is incomplete or the App is not installed on the
repository.

## Step 7: Verify the release

Tasks:

1. `gh release view <tag> -R okocraft/<name> --json tagName,isDraft,isPrerelease,body,assets,url`:
   not a draft; prerelease only if the version contains `-`; body equals the
   approved notes.
2. `git ls-remote https://github.com/okocraft/<name> refs/tags/<tag>` points
   to the SHA from Step 6.
3. Assets: the expected binaries only (compare names with the previous
   release), none empty. Download them and check that the plugin metadata
   (`plugin.yml`, `paper-plugin.yml` or `velocity-plugin.json`) contains the
   released version, e.g. `unzip -p <jar> plugin.yml | grep '^version'`.

Done when all three checks pass. If one fails, report it and ask the human
how to fix it; do not edit the release.

## Step 8: Report

Report to the human:

- release URL, tag, commit SHA and version,
- asset names with sizes and SHA-256 (`digest` in the release JSON),
- the result of each check in Step 7,
- anything you could not verify, and follow-ups (for example, whether the
  repository usually moves the source version to the next `-SNAPSHOT` after
  a release; check its history and offer a PR if so).

## Appendix: one-time setup for public repositories

Done by a maintainer, not by the agent. If it is missing, ask for it.

1. A GitHub App with repository permission **Contents: Read and write**,
   installed on the okocraft public repositories to release.
2. In public-ops, the `release` environment with required reviewers (prevent
   self-review, no administrator bypass), limited to the `main` branch.
3. In that environment, the variable `RELEASER_APP_CLIENT_ID` and the secret
   `RELEASER_APP_PRIVATE_KEY`.
