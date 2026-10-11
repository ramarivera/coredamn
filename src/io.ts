import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Agent, Diagnostic } from "./types.ts";

export class Diagnostics {
  private entries = new Map<string, Diagnostic>();
  add(agent: Agent, code: string, count = 1): void {
    const key = `${agent}:${code}`;
    const item = this.entries.get(key) ?? {
      agent,
      code,
      count: 0,
      severity:
        code === "legacy-format" || code === "metadata-only-file"
          ? ("info" as const)
          : ("warning" as const),
    };
    item.count += count;
    this.entries.set(key, item);
  }
  list(): Diagnostic[] {
    return [...this.entries.values()].sort((a, b) =>
      `${a.agent}:${a.code}`.localeCompare(`${b.agent}:${b.code}`),
    );
  }
}

// Never follow directory symlinks: unrelated trees and cycles are not transcript sources.
export async function* files(
  root: string,
  accepts: (name: string) => boolean,
): AsyncGenerator<string> {
  const info = await lstat(root);
  if (info.isSymbolicLink()) {
    // Explicit configured roots may be symlinks; resolve just this root, not children.
    const { realpath } = await import("node:fs/promises");
    yield* files(await realpath(root), accepts);
  } else if (info.isFile()) {
    if (accepts(basename(root))) yield root;
  } else if (info.isDirectory()) {
    for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.isDirectory()) yield* files(join(root, entry.name), accepts);
      else if (entry.isFile() && accepts(entry.name)) yield join(root, entry.name);
    }
  }
}

export async function* jsonLines(
  path: string,
  agent: Agent,
  diagnostics: Diagnostics,
): AsyncGenerator<unknown> {
  const input = createReadStream(path, { encoding: "utf8" });
  // readline also splits U+2028/U+2029, which JSON permits inside strings.
  // JSONL records are delimited by LF, optionally preceded by CR, only.
  let pending = "";
  const parse = (line: string, trailing = false): { value: unknown } | undefined => {
    if (!line.trim()) return;
    try {
      const value: unknown = JSON.parse(line);
      return { value };
    } catch {
      diagnostics.add(
        agent,
        trailing ? "truncated-or-malformed-final-record" : "malformed-json-line",
      );
      return;
    }
  };
  try {
    for await (const chunk of input) {
      pending += chunk;
      let start = 0;
      let end = pending.indexOf("\n", start);
      while (end !== -1) {
        const record = parse(pending.slice(start, end));
        if (record) yield record.value;
        start = end + 1;
        end = pending.indexOf("\n", start);
      }
      pending = pending.slice(start);
    }
    const record = parse(pending, true);
    if (record) yield record.value;
  } finally {
    input.destroy();
  }
}
