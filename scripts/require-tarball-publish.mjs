process.stderr.write(
  "Publish the verified tarball produced by pnpm package, not the source directory. See docs/publishing.md.\n",
);
process.exitCode = 1;
