import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { TranscriptService } from "../src/scan.ts";
import { workspace } from "./helpers.ts";

test("valid Unicode separators survive streaming JSONL; broken tail still warns", async () => {
  const root = await workspace();
  const file = join(root, "unicode.jsonl");
  const turn = (id: string, text: string) =>
    JSON.stringify({ type: "user", uuid: id, message: { role: "user", content: text } });
  // The long record crosses filesystem stream chunks; the two separators are
  // legal JSON string contents, not record boundaries.
  await writeFile(
    file,
    `${turn("one", `hello\u2028shit\u2029world ${"a".repeat(70000)}`)}\r\n${turn("two", "damn fix it")}\n{"type":"user"`,
  );
  const report = await Effect.runPromise(
    TranscriptService.use((s) => s.scan({ paths: [`claude=${file}`] })).pipe(
      Effect.provide(TranscriptService.layer),
    ),
  );
  assert.equal(report.totals.messages, 2);
  assert.equal(report.totals.hits, 2);
  assert.equal(report.status, "partial");
  assert.deepEqual(
    report.diagnostics.map((d) => d.code),
    ["truncated-or-malformed-final-record"],
  );
});

test("OMP developer turns are recognized but never count as human messages", async () => {
  const root = await workspace();
  const file = join(root, "omp.jsonl");
  await writeFile(
    file,
    [
      { type: "session", id: "session" },
      {
        type: "message",
        id: "context",
        message: {
          role: "developer",
          attribution: "agent",
          content: [{ type: "text", text: "shit" }],
        },
      },
      { type: "message", id: "human", message: { role: "user", content: "hello" } },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n"),
  );
  const report = await Effect.runPromise(
    TranscriptService.use((s) => s.scan({ paths: [`omp=${file}`] })).pipe(
      Effect.provide(TranscriptService.layer),
    ),
  );
  assert.equal(report.totals.messages, 1);
  assert.equal(report.totals.hits, 0);
  assert.equal(report.status, "complete");
  assert.deepEqual(report.diagnostics, []);
});

test("known launcher metadata is informational; unknown records still warn", async () => {
  const root = await workspace();
  const file = join(root, "launcher.jsonl");
  await writeFile(file, '{"type":"launched"}\n{"type":"result"}\n');
  const scan = () =>
    Effect.runPromise(
      TranscriptService.use((s) => s.scan({ paths: [`claude=${file}`] })).pipe(
        Effect.provide(TranscriptService.layer),
      ),
    );
  const report = await scan();
  assert.equal(report.status, "empty");
  assert.equal(report.diagnostics[0]?.severity, "info");
  await writeFile(file, '{"type":"unknown-format"}\n');
  assert.equal((await scan()).status, "partial");
});
