import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, symlink, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const root = fileURLToPath(new URL("../", import.meta.url));
export const scratch = resolve(
  process.env.COREDAMN_SCRATCH_DIR ?? join(homedir(), ".cache", "coredamn", "development"),
);
export async function build() {
  await mkdir(scratch, { recursive: true });
  const output = join(await mkdtemp(join(scratch, "build-")), "dist");
  // Node resolves imports through the real scratch path behind local dist.
  await symlink(join(root, "node_modules"), join(output, "..", "node_modules"), "dir");
  execFileSync(
    resolve(root, "node_modules/.bin/tsc"),
    ["--project", "tsconfig.build.json", "--outDir", output],
    { cwd: root, stdio: "inherit" },
  );
  const local = join(root, "dist");
  const info = await lstat(local).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (info && !info.isSymbolicLink())
    throw new Error("dist exists and isn't a symlink. Preserve it and move it before building.");
  if (info) await unlink(local);
  await symlink(output, local, "dir");
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${await build()}\n`);
}
