import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { root, scratch } from "./build.mjs";

const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
assert.equal(process.env.GITHUB_REPOSITORY, "ramarivera/coredamn");
assert.equal(process.env.GITHUB_REF, `refs/tags/v${manifest.version}`);
assert.ok(process.env.ACTIONS_ID_TOKEN_REQUEST_URL, "GitHub OIDC is required");
assert.ok(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, "GitHub OIDC is required");
// Distinguish missing versions from network/auth failures. Never turn an
// arbitrary npm view failure into permission to publish.
const response = await fetch(
  `https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${manifest.version}`,
  { signal: AbortSignal.timeout(30_000) },
);
if (response.ok) {
  process.stdout.write(
    `${manifest.name}@${manifest.version} already exists; no publish performed.\n`,
  );
} else {
  assert.equal(response.status, 404, `Registry lookup failed with HTTP ${response.status}`);
  execFileSync(
    "npm",
    [
      "publish",
      join(scratch, "artifacts", `${manifest.name}-${manifest.version}.tgz`),
      "--access",
      "public",
      "--provenance",
    ],
    { cwd: root, stdio: "inherit" },
  );
}
