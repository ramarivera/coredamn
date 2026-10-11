import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { root, scratch } from "./build.mjs";

await mkdir(scratch, { recursive: true });
const fixture = await mkdtemp(join(scratch, "install-proof-"));
const sourceManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const archive = join(scratch, "artifacts", `${sourceManifest.name}-${sourceManifest.version}.tgz`);
await writeFile(
  join(fixture, "package.json"),
  JSON.stringify({ name: "coredamn-install-proof", private: true, type: "module" }),
);
execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive], {
  cwd: fixture,
  stdio: "inherit",
});
const binary = join(fixture, "node_modules/.bin/coredamn");
const help = spawnSync(binary, ["--help"], { encoding: "utf8" });
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /discover/u);
assert.match(help.stdout, /scan/u);
assert.match(help.stdout, /plan/u);
assert.match(help.stdout, /tui/u);
const input = join(fixture, "claude.jsonl");
await writeFile(
  input,
  [
    {
      type: "user",
      sessionId: "private-session",
      uuid: "u1",
      timestamp: "2026-10-11T09:00:00.000Z",
      message: { role: "user", content: "shit fix this" },
    },
    { type: "assistant", message: { role: "assistant", content: [], model: "fixture-model" } },
  ]
    .map((record) => JSON.stringify(record))
    .join("\n") + "\n",
);
const output = spawnSync(binary, ["scan", "--path", `claude=${input}`, "--format", "json"], {
  encoding: "utf8",
});
assert.equal(output.status, 0, output.stderr);
const report = JSON.parse(output.stdout);
assert.equal(report.totals.hits, 1);
assert.equal(report.totals.words, 3);
assert.equal(report.byModel[0].label, "claude / fixture-model");
assert.ok(!output.stdout.includes("private-session"));
const plan = spawnSync(binary, ["plan", "--path", `claude=${input}`, "--format", "json"], {
  encoding: "utf8",
});
assert.equal(plan.status, 0, plan.stderr);
assert.equal(JSON.parse(plan.stdout).eligibleMessages, 1);
assert.ok(!plan.stdout.includes('"hits"'));
const card = join(fixture, "card.png");
const png = spawnSync(
  binary,
  ["scan", "--path", `claude=${input}`, "--format", "png", "--output", card],
  {
    encoding: "utf8",
  },
);
assert.equal(png.status, 0, png.stderr);
const bytes = await readFile(card);
assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
assert.equal(bytes.readUInt32BE(16), 1200);
assert.equal(bytes.readUInt32BE(20), 630);
const manifest = JSON.parse(
  await readFile(join(fixture, "node_modules/coredamn/package.json"), "utf8"),
);
assert.ok(!manifest.devDependencies);
assert.ok(!manifest.scripts);
assert.equal(manifest.dependencies.effect, "4.0.3");
assert.equal(manifest.dependencies.commander, "15.0.0");
assert.equal(manifest.dependencies.ink, "8.0.0");
assert.equal(manifest.dependencies.react, "19.3.0");
assert.equal(manifest.dependencies["@resvg/resvg-js"], "2.6.2");
assert.equal(manifest.dependencies["node-llama-cpp"], "3.22.1");
const version = spawnSync(binary, ["--version"], { encoding: "utf8" });
assert.equal(
  version.stdout.trim(),
  JSON.parse(await readFile(join(root, "package.json"), "utf8")).version,
);
process.stdout.write(
  `Packaged install proof passed: real npm tarball, isolated install, Commander help, scan, count-only plan, PNG and runtime dependencies.\n${fixture}\n`,
);
