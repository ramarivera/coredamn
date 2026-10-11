import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { root, scratch } from "./build.mjs";

await mkdir(scratch, { recursive: true });
const fixture = await mkdtemp(join(scratch, "compiler-proof-"));
await writeFile(join(fixture, "package.json"), '{"type":"module"}');
await symlink(join(root, "node_modules"), join(fixture, "node_modules"), "dir");
await writeFile(
  join(fixture, "tsconfig.json"),
  JSON.stringify({
    extends: join(root, "tsconfig.json"),
    compilerOptions: { rootDir: fixture, noEmit: true },
    include: ["fixture.ts"],
  }),
);
const source = join(fixture, "fixture.ts");
const run = () =>
  spawnSync(join(root, "node_modules/.bin/tsc"), ["--project", join(fixture, "tsconfig.json")], {
    encoding: "utf8",
  });
await writeFile(source, 'import { Effect } from "effect";\nEffect.succeed(1);\n');
const failing = run();
assert.notEqual(failing.status, 0, "floating Effect must fail the compiler");
assert.match(
  failing.stdout + failing.stderr,
  /floating|not.*used|discarded/iu,
  "must fail for the Effect diagnostic, not module resolution",
);
await writeFile(
  source,
  'import { Effect } from "effect";\nexport const program = Effect.succeed(1);\n',
);
const passing = run();
assert.equal(passing.status, 0, passing.stdout + passing.stderr);
process.stdout.write(
  "Effect compiler gate rejected a floating Effect and accepted the corrected fixture.\n",
);
