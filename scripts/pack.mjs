import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build, root, scratch } from "./build.mjs";

const dist = await build();
const staging = await mkdtemp(join(scratch, "package-"));
for (const path of ["bin", "README.md", "LICENSE", "docs"])
  await cp(join(root, path), join(staging, path), { recursive: true });
await cp(dist, join(staging, "dist"), { recursive: true });
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const { scripts, devDependencies, packageManager, ...published } = manifest;
await writeFile(join(staging, "package.json"), `${JSON.stringify(published, null, 2)}\n`);
const artifacts = join(scratch, "artifacts");
await mkdir(artifacts, { recursive: true });
execFileSync("npm", ["pack", "--pack-destination", artifacts], { cwd: staging, stdio: "inherit" });
