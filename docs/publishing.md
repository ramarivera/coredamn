# npm releases

The code repository and npm package `coredamn` are public. Published
tarballs contain built CLI files, README, license, format evidence and dependency
metadata. They don't contain transcripts or local model weights.

The workflow uses version tags, GitHub-hosted runners and npm OIDC with
`id-token: write`. Actions
are pinned by commit, installs use the frozen pnpm lockfile, and verification
runs before publishing. Node 24.18.0 and npm 11.16.0 are pinned. No npm publish
token is stored in GitHub secrets. The CLI package keeps its own build/pack steps.

## First publish and trust configuration

The package must already exist before configuring a trusted publisher. npm trust
requires npm 11.15.0 or later, account-level 2FA, and authenticated package write
access. [npm trust documentation](https://docs.npmjs.com/cli/v11/commands/npm-trust/)
describes the supported authentication methods.

Run these from the repository after the code and workflow have been pushed:

```nu
npm login
npm whoami
pnpm check
pnpm package
pnpm check:package
npm publish ~/.cache/coredamn/development/artifacts/coredamn-0.1.0.tgz --access public
npm trust github coredamn --repository ramarivera/coredamn --file publish.yml --allow-publish --yes
npm trust list coredamn
```

The first publish and trust setup may require interactive 2FA. Don't put OTPs or
registry tokens into source files or workflow secrets. A direct `npm publish`
from the source directory deliberately fails; use the verified tarball.

A new trusted-publisher connection must complete a successful publish within two
days to remain valid. After bootstrap, bump the version and publish it through
the workflow. A workflow that skips an already-published version doesn't validate
the connection. See [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/).

## Subsequent releases

Update the package version and CLI version together, run the checks, and push
that commit. Create and push the matching version tag, for example `v0.1.1`.
`.github/workflows/publish.yml` checks that the tag matches package.json, then
builds and publishes the staged tarball using npm OIDC. Existing versions are
skipped; registry errors fail the job. GitHub workflow dispatch verifies by
default. Publishing on dispatch requires selecting a matching version tag and
setting its `publish` input to true.

The initial `0.1.0` version is intentionally left for the manual bootstrap.
Don't push a new release tag until its trusted publisher has been configured.

## Provenance

Trusted publishing from the public repository automatically produces npm
provenance. The workflow also explicitly requests `--provenance`. The
package's repository URL must match the source repository. See
[npm trusted publishers](https://docs.npmjs.com/trusted-publishers/).
