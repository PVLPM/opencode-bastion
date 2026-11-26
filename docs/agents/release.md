# Release

How a maintainer cuts an OpenCode Bastion release and stages it on npm. Read
`AGENTS.md` first for project rules. Releases are manual: nothing publishes on a
tag push, a GitHub Release, a schedule or a branch push.

## Prerequisites

- Node `>=22.18.0` and pnpm `10.33.0` (the `packageManager` version). The pack
  script checks the Node minimum; the CI publishing job uses Node 24, and the
  runtime smoke runs on Node 22 and 24.
- The version in `package.json` committed on the tag's commit. No tooling
  rewrites it during a release, and the tag must match it exactly (`v0.1.0` ↔
  `0.1.0`).

## Local checks before tagging

```sh
pnpm run release:check            # pnpm verify && pnpm run verify:release-version
pnpm run verify:release-package   # temp-dir pack + install + load smoke
```

`release:check` skips the tag check unless `RELEASE_TAG` is set, so local runs
and `prepublishOnly` never depend on a stale `GITHUB_REF`. A `RELEASE_TAG` that
is set but blank is an error, never a silent skip:

```sh
$env:RELEASE_TAG='v0.1.0'; node scripts/verify-release-version.mjs   # PowerShell
RELEASE_TAG=v0.1.0 node scripts/verify-release-version.mjs            # POSIX
```

To inspect the exact artifact, pack once into an empty directory and smoke it:

```sh
pnpm run pack:release-package package-artifacts
pnpm run smoke:package package-artifacts
```

`pack:release-package` packs once with `pnpm --config.ignore-scripts=true pack`
into the empty directory, checks the strict content allowlist, the
export/peer/engine metadata, the README image reference and the 1 MiB size
limit, then writes `release-artifact.json`
(`{ version: 1, filename, sha256 }`). `verify-release-artifact.mjs` re-checks
the manifest and SHA before any upload or staging. `package-artifacts/` is
gitignored.

## GitHub release

```sh
git tag v0.1.0
git push origin v0.1.0
gh release create v0.1.0 --notes-file <notes.md>
```

The tag and the GitHub Release are the release identity; the npm staging
workflow checks out `refs/tags/<tag>` and refuses a tag/version mismatch.

## npm staging (manual workflow)

Dispatch **Publish to npm (manual tag dispatch)**
(`.github/workflows/publish-npm.yml`) with the existing `tag` and `publish`
(default `false`).

| Input | Required | Default | Meaning |
| --- | --- | --- | --- |
| `tag` | yes | — | Existing tag whose commit already has the matching `package.json` version. The workflow never creates or moves a tag. |
| `publish` | yes | `false` | Submit the verified tarball to npm Staged Packages. Also requires the repository variable `NPM_PUBLISH_ENABLED` to be exactly `true`. |

- `release-package`: checks out the tag, asserts the checked-out commit is the
  tag commit, runs `verify:release-version` with `RELEASE_TAG`, then `pnpm
  verify`, packs once and uploads that tarball with its SHA-256 manifest.
- `runtime-smoke`: installs and loads the uploaded tarball on Node 22 and 24.
- `publish`: only with both switches, it installs npm >= 11.15.0, verifies the
  tarball against the manifest, chooses `next` for prerelease versions and
  `latest` otherwise, and runs `npm stage publish` with provenance over OIDC
  (`id-token: write`). It never rebuilds or repacks.

The workflow never publishes publicly and never writes to the repository. The
owner reviews the staged package on npmjs.com and clicks **Approve** with 2FA.
Configure the npm Trusted Publisher with `npm stage publish` allowed and both
`npm publish` and `npm dist-tag` disabled; direct publishing from CI is not
permitted.

## Package contents

The tarball ships exactly four files: `LICENSE`, `README.md`, `package.json` and
`dist/gui-experimental.cjs`. Source maps, `src`, `docs`, `preview`, `scripts`,
`test` and `.github` are rejected by `verify-package-contents.mjs`, which also
enforces `exports["./gui-experimental"]`, the `@opencode/plugin >=2.4.0 <2.5.0`
peer range, `engines.node >=22.18.0`, and a tarball under 1 MiB.

The README animation is a 7.18 MB WebP served from an absolute
`raw.githubusercontent.com` URL, so it stays out of the package. Do not point
the README at a local image.

## The packed smoke is not Desktop

`smoke-packed-package.mjs` installs the tarball with `--legacy-peer-deps` plus
`solid-js`, writes a temporary host-shaped `@opencode/plugin` stub exposing
`./gui`, and requires `opencode-bastion/gui-experimental` with Node's `browser`
condition and a minimal `window.document`. It proves the artifact loads and
exports `default.setup`; it is not the real Desktop runtime, does not render the
panel, and does not replace testing in OpenCode Desktop 2.4.x.
