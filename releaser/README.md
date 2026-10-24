# Releaser

Releaser turns "release okocraft/Hugs at 1.5" into a GitHub Release with the
built binaries attached. Target repositories need **no Releaser configuration
file**: the existing Gradle or Maven build is the source of truth.

## Releasing

Everything needed to release a repository, including the per-repository
setup, workflow inputs, discovery rules and release note rules, is in
[RUNBOOK.md](RUNBOOK.md). Give it to an agent together with the repository
to release, or follow it yourself.

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
