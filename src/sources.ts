import { existsSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { readGrok } from "./adapters/grok.ts";
import { JsonlParser } from "./adapters/jsonl.ts";
import { readDatabase } from "./adapters/sqlite.ts";
import type { ResolveOptions } from "./config.ts";
import { discover } from "./config.ts";
import { type ConfigurationError, type DatabaseReadError, InputReadError } from "./errors.ts";
import { Diagnostics, files, jsonLines } from "./io.ts";
import type { Location, Message } from "./types.ts";

const sourceFiles = Effect.fn("TranscriptSources.files")(function* (
  location: Location,
): Effect.fn.Return<string[], InputReadError> {
  return yield* Effect.tryPromise({
    try: async () => {
      const root = location.path;
      const info = await lstat(root);
      let roots = [root];
      if (!info.isFile()) {
        const subdirs =
          location.agent === "claude"
            ? ["projects", "transcripts"]
            : location.agent === "codex"
              ? ["sessions", "archived_sessions"]
              : location.agent === "cursor"
                ? ["User/globalStorage", "User/workspaceStorage"]
                : location.agent === "opencode"
                  ? ["opencode.db"]
                  : [];
        const existing = subdirs.map((p) => join(root, p)).filter((p) => existsSync(p));
        if (existing.length) roots = existing;
      }
      const accepts = (name: string) =>
        location.agent === "grok"
          ? name === "chat_history.jsonl"
          : location.agent === "opencode"
            ? name.endsWith(".db")
            : location.agent === "cursor"
              ? name === "state.vscdb"
              : name.endsWith(".jsonl");
      const result: string[] = [];
      for (const dir of roots)
        for await (const path of files(dir, accepts)) result.push(await realpath(path));
      return result;
    },
    catch: () => InputReadError.create(),
  });
});
const readJsonl = Effect.fn("TranscriptSources.readJsonl")(function* (
  path: string,
  location: Location,
  diagnostics: Diagnostics,
): Effect.fn.Return<Message[], InputReadError> {
  const parser = new JsonlParser(location.agent, path, diagnostics);
  yield* Effect.tryPromise({
    try: async () => {
      for await (const value of jsonLines(path, location.agent, diagnostics)) parser.consume(value);
    },
    catch: () => InputReadError.create(),
  });
  return parser.finish();
});

export class SourceService extends Context.Service<SourceService>()("coredamn/SourceService", {
  make: Effect.sync(() => ({
    discover,
    visit: Effect.fn("SourceService.visit")(function* <E, R>(
      options: ResolveOptions,
      consume: (message: Message) => Effect.Effect<void, E, R>,
      diagnostics: Diagnostics,
    ): Effect.fn.Return<number, ConfigurationError | E, R> {
      const locations = yield* discover(options);
      const seenFiles = new Set<string>();
      let filesRead = 0;
      for (const location of locations) {
        if (!location.exists) {
          if (location.explicit || location.unreadable)
            diagnostics.add(location.agent, "configured-path-unavailable");
          continue;
        }
        const candidates = yield* sourceFiles(location).pipe(
          Effect.catchTag("InputReadError", () => {
            diagnostics.add(location.agent, "input-read-failed");
            return Effect.succeed([] as string[]);
          }),
        );
        if (!candidates.length && location.explicit)
          diagnostics.add(location.agent, "no-supported-files");
        for (const path of candidates) {
          const key = `${location.agent}:${path}`;
          if (seenFiles.has(key)) continue;
          seenFiles.add(key);
          const read: Effect.Effect<Message[], InputReadError | DatabaseReadError> =
            location.agent === "cursor" || location.agent === "opencode"
              ? readDatabase(path, location.agent, diagnostics)
              : location.agent === "grok"
                ? readGrok(path, diagnostics)
                : readJsonl(path, location, diagnostics);
          const result = yield* read.pipe(
            Effect.map((messages) => ({ messages, read: true })),
            Effect.catchTags({
              InputReadError: () => {
                diagnostics.add(location.agent, "input-read-failed");
                return Effect.succeed({ messages: [] as Message[], read: false });
              },
              DatabaseReadError: () => {
                diagnostics.add(location.agent, "unsupported-or-unreadable-database");
                return Effect.succeed({ messages: [] as Message[], read: false });
              },
            }),
          );
          if (result.read) filesRead++;
          for (const message of result.messages) yield* consume(message);
        }
      }
      return filesRead;
    }),
  })),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
