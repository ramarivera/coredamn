import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { cases } from "../test/fixtures/native-cases.ts";
import { root, scratch } from "./build.mjs";

// Deliberately opt-in. This reads only synthetic fixtures and existing weights.
const model = process.argv[2];
assert.ok(model, "Usage: node scripts/native-proof.mjs /path/to/Qwen3.5-27B.gguf");
await mkdir(scratch, { recursive: true });
const fixture = await mkdtemp(join(scratch, "native-proof-"));
const source = join(fixture, "synthetic.jsonl");
const cache = join(fixture, "cache");
await writeFile(
  source,
  cases
    .map((c, index) =>
      JSON.stringify({
        type: "user",
        uuid: c.id,
        sessionId: `synthetic-${c.id}`,
        timestamp: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
        message: { role: "user", content: c.text },
      }),
    )
    .join("\n"),
  { mode: 0o600 },
);
const common = [
  "--path",
  `claude=${source}`,
  "--detector",
  "local",
  "--model",
  model,
  "--cache-dir",
  cache,
  "--gpu",
  process.env.COREDAMN_PROOF_GPU ?? "vulkan",
  "--format",
  "json",
];
async function run(command, filename) {
  const output = join(fixture, filename);
  const start = performance.now();
  const result = spawnSync(
    process.execPath,
    [join(root, "bin/coredamn.mjs"), command, ...common, "--output", output],
    { cwd: root, stdio: "inherit", timeout: 20 * 60 * 1000 },
  );
  assert.equal(
    result.status,
    0,
    `${command} failed: ${result.error?.message ?? result.signal ?? result.status}`,
  );
  return { value: JSON.parse(await readFile(output, "utf8")), ms: performance.now() - start };
}
const before = await run("plan", "before.json");
assert.equal(before.value.pendingMessages, cases.length);
assert.equal(before.value.eligibleMessages, cases.length);
await assert.rejects(access(cache));
const first = await run("scan", "first.json");
assert.equal(first.value.analysis.inferredMessages, cases.length);
assert.equal(first.value.analysis.skippedMessages, 0);
for (const [index, expected] of cases.entries()) {
  const date = `2026-09-${String(index + 1).padStart(2, "0")}`;
  const actual = first.value.byDay.find((row) => row.label === date);
  assert.ok(actual, `${expected.id}: missing analyzed day`);
  assert.equal(actual.insults, expected.insults.length, `${expected.id}: insult occurrences`);
  assert.equal(
    actual.profanity,
    expected.profanity.length,
    `${expected.id}: profanity occurrences`,
  );
  const perCase = spawnSync(
    process.execPath,
    [
      join(root, "bin/coredamn.mjs"),
      "scan",
      ...common,
      "--since",
      date,
      "--until",
      date,
      "--quiet",
    ],
    { cwd: root, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(perCase.status, 0, `${expected.id}: cached per-case scan failed`);
  const selected = JSON.parse(perCase.stdout);
  assert.equal(selected.analysis.inferredMessages, 0);
  const termsFor = (category) =>
    selected.terms
      .filter((term) => term.category === category)
      .flatMap((term) => Array(term.count).fill(term.term))
      .sort();
  assert.deepEqual(
    termsFor("insult"),
    [...expected.insults].sort(),
    `${expected.id}: exact insults`,
  );
  assert.deepEqual(
    termsFor("profanity"),
    [...expected.profanity].sort(),
    `${expected.id}: exact profanity`,
  );
}
const expectedTerms = new Map();
for (const c of cases)
  for (const term of [...c.insults, ...c.profanity])
    expectedTerms.set(term, (expectedTerms.get(term) ?? 0) + 1);
assert.deepEqual(new Map(first.value.terms.map((t) => [t.term, t.count])), expectedTerms);
const second = await run("scan", "second.json");
assert.equal(second.value.analysis.inferredMessages, 0);
assert.equal(second.value.analysis.cachedMessages, cases.length);
assert.deepEqual(second.value.totals, first.value.totals);
const after = await run("plan", "after.json");
assert.equal(after.value.pendingMessages, 0);
assert.equal(after.value.cachedMessages, cases.length);
assert.equal(after.value.estimatedSeconds, 0);
for (const filename of await readdir(cache)) {
  const text = await readFile(join(cache, filename), "utf8");
  const entry = JSON.parse(text);
  assert.deepEqual(Object.keys(entry).sort(), [
    "insultScore",
    "profanityScore",
    "spans",
    "version",
  ]);
  assert.ok(!text.includes("targetMessage"));
}
const summary = {
  cases: cases.length,
  countChecksPassed: cases.length,
  exactAggregateTermsPassed: true,
  firstMs: first.ms,
  cachedMs: second.ms,
  inferredOnRepeat: 0,
  cachedOnRepeat: cases.length,
};
await writeFile(join(fixture, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(
  `Native CLI and cache proof passed.\n${JSON.stringify(summary)}\n${fixture}\n`,
);
