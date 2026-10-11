import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Option, Schema } from "effect";
import { JsonlParser } from "../src/adapters/jsonl.ts";
import { Aggregator } from "../src/aggregate.ts";
import { Diagnostics } from "../src/io.ts";
import { matches, rules } from "../src/lexicon.ts";
import { html, terminal } from "../src/report.ts";
import { TranscriptService } from "../src/scan.ts";
import { ClaudeTurn, TreeTurn } from "../src/schemas.ts";
import { prose, wordCount } from "../src/text.ts";
import { LANGUAGES } from "../src/types.ts";
import { fixtureAll, when, workspace } from "./helpers.ts";

test("all seven adapters count humans, follow model switches, and avoid raw text output", async () => {
  const root = await workspace();
  const config = await fixtureAll(root);
  const report = await Effect.runPromise(
    TranscriptService.use((s) => s.scan({ config })).pipe(Effect.provide(TranscriptService.layer)),
  );
  assert.equal(report.status, "complete");
  assert.equal(report.byAgent.length, 7);
  assert.equal(report.filesRead, 7);
  assert.equal(report.totals.messages, 9);
  assert.equal(report.totals.hits, 9);
  assert.equal(report.totals.profanity, 6);
  assert.equal(report.totals.insults, 3);
  assert.equal(report.unknownDates, 1);
  assert.deepEqual(
    report.byModel.filter((r) => r.label.startsWith("claude")).map((r) => r.label),
    ["claude / claude-first", "claude / claude-second"],
  );
  assert.equal(report.byModel.find((r) => r.label === "codex / codex-two")?.messages, 1);
  assert.equal(report.byModel.find((r) => r.label === "grok / grok-first")?.messages, 1);
  for (const output of [JSON.stringify(report), html(report), terminal(report)]) {
    assert.ok(!output.includes("PRIVATE_SENTINEL_RAW"));
    assert.ok(!output.includes("SECRET_SESSION"));
    assert.ok(!output.includes(root));
    assert.ok(!output.includes("WRONG_LAST_MODEL"));
  }
  // Denominator really is user prose, with code removed, not model usage tokens.
  assert.equal(report.totals.words, 25);
  assert.equal(report.totals.per1000Words, 360);
});

test("native schemas reject wrong consumed fields and malformed content", () => {
  assert.ok(
    Option.isNone(
      Schema.decodeUnknownOption(ClaudeTurn)({
        type: "user",
        message: { role: "user", content: 42 },
      }),
    ),
  );
  assert.ok(
    Option.isNone(
      Schema.decodeUnknownOption(TreeTurn)({
        type: "message",
        id: 1,
        message: { role: "user", content: "shit" },
      }),
    ),
  );
  const diag = new Diagnostics();
  const p = new JsonlParser("omp", "fixture", diag);
  p.consume({
    type: "message",
    id: "bad",
    message: { role: "user", content: [{ type: "text", text: 12 }] },
  });
  assert.equal(p.finish().length, 0);
  assert.ok(diag.list().some((d) => d.code === "invalid-record"));
});

test("code, word boundaries and neutral multilingual fragments don't inflate matches", () => {
  const lexicon = rules({}, LANGUAGES);
  const text = prose(
    "class assignment compass fucking SHIT\n```ts\nfuck\n```\n`idiot` https://example.com/shit",
  );
  assert.deepEqual(
    matches(text, lexicon).map((t) => t.term),
    ["fucking", "shit"],
  );
  assert.equal(matches("中文文字，日本語の文章，한국어 문장", lexicon).length, 0);
  assert.equal(matches("他妈的 バカ 씨발 scheiße imbécil", lexicon).length, 5);
  assert.equal(matches(prose("hello\n~~~js\nshit\n"), lexicon).length, 0);
  assert.equal(wordCount("hello world"), 2);
});

test("custom terms, ignore rules and language selection share the same matcher", () => {
  const lexicon = rules(
    { ignoreTerms: ["shit"], terms: [{ term: "nitwit", category: "insult", language: "en" }] },
    ["en"],
  );
  assert.deepEqual(
    matches("shit nitwit scheiße", lexicon).map((t) => t.term),
    ["nitwit"],
  );
});

test("archived copies are deduplicated; date filters are inclusive and unknown dates excluded", async () => {
  const root = await workspace();
  const config = await fixtureAll(root);
  await mkdir(join(root, "claude", "transcripts"));
  await copyFile(
    join(root, "claude", "projects", "project", "session.jsonl"),
    join(root, "claude", "transcripts", "copy.jsonl"),
  );
  const all = await Effect.runPromise(
    TranscriptService.use((s) => s.scan({ config })).pipe(Effect.provide(TranscriptService.layer)),
  );
  assert.equal(all.duplicatesRemoved, 2);
  assert.equal(all.totals.messages, 9);
  const filtered = await Effect.runPromise(
    TranscriptService.use((s) =>
      s.scan({ config }, { since: "2026-10-12", until: "2026-10-12" }),
    ).pipe(Effect.provide(TranscriptService.layer)),
  );
  assert.equal(filtered.totals.messages, 1);
  assert.equal(filtered.totals.insults, 1);
  assert.equal(filtered.status, "partial");
  assert.ok(filtered.diagnostics.some((d) => d.code === "undated-excluded"));
});

test("malformed and unsupported input produces partial coverage, never a clean zero", async () => {
  const root = await workspace();
  const path = join(root, "bad.jsonl");
  await writeFile(path, '{"type":"user","message":{"role":"user","content":42}}\n{bad json\n');
  const report = await Effect.runPromise(
    TranscriptService.use((s) => s.scan({ agents: ["claude"], paths: [`claude=${path}`] })).pipe(
      Effect.provide(TranscriptService.layer),
    ),
  );
  assert.equal(report.status, "partial");
  assert.equal(report.totals.messages, 0);
  assert.ok(report.diagnostics.some((d) => d.code === "malformed-json-line"));
  assert.ok(report.diagnostics.some((d) => d.code === "invalid-record"));
  const missing = await Effect.runPromise(
    TranscriptService.use((s) => s.scan({ paths: [`grok=${join(root, "absent")}`] })).pipe(
      Effect.provide(TranscriptService.layer),
    ),
  );
  assert.equal(missing.status, "partial");
  assert.equal(missing.diagnostics[0]?.code, "configured-path-unavailable");
});

test("Codex response-only legacy fallback strips injected context and marks coverage", () => {
  const diag = new Diagnostics();
  const p = new JsonlParser("codex", "fixture", diag);
  p.consume({ type: "session_meta", payload: { id: "s" } });
  p.consume({
    type: "response_item",
    timestamp: when,
    payload: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: "<environment_context>shit</environment_context>\n## My request for Codex:\ndamn fix it",
        },
      ],
    },
  });
  p.consume({
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "# AGENTS.md instructions\nshit" }],
    },
  });
  const messages = p.finish();
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.text, "damn fix it");
  assert.equal(messages[0]?.confidence, "legacy");
  assert.equal(diag.list()[0]?.code, "legacy-format");
});

test("HTML embeds aggregates safely and carries an offline CSP with executable script hash", () => {
  const a = new Aggregator(
    {
      terms: [
        { term: "</script><img src=x onerror=alert(1)>", category: "insult", language: "en" },
      ],
    },
    {},
    new Diagnostics(),
  );
  a.add({
    agent: "claude",
    session: "secret",
    id: "1",
    text: "shit",
    timestamp: Option.some(when),
    model: Option.some("</script><img src=x onerror=alert(1)>"),
    confidence: "structured",
  });
  const output = html(a.finish(1));
  assert.ok(!output.includes("</script><img"));
  assert.match(output, /connect-src 'none'/u);
  assert.match(output, /script-src 'sha256-/u);
  assert.match(output, /\\u003c\/script\\u003e/u);
  assert.ok(!output.includes('src="https://'));
});

test("reading SQLite inputs leaves the original database bytes untouched", async () => {
  const root = await workspace();
  const config = await fixtureAll(root);
  const database = join(root, "opencode", "opencode.db");
  const before = await readFile(database);
  await Effect.runPromise(
    TranscriptService.use((s) => s.scan({ config, agents: ["opencode"] })).pipe(
      Effect.provide(TranscriptService.layer),
    ),
  );
  assert.deepEqual(await readFile(database), before);
});

test("tree branches resolve the model from parent entries", () => {
  const p = new JsonlParser("omp", "fixture", new Diagnostics());
  p.consume({ type: "session", id: "s" });
  p.consume({ type: "model_change", id: "m1", parentId: null, model: "provider/one" });
  p.consume({
    type: "message",
    id: "u1",
    parentId: "m1",
    message: { role: "user", content: "shit" },
  });
  p.consume({ type: "model_change", id: "m2", parentId: "u1", model: "provider/two" });
  p.consume({
    type: "message",
    id: "u2",
    parentId: "m2",
    message: { role: "user", content: "damn" },
  });
  p.consume({
    type: "message",
    id: "u3",
    parentId: "m1",
    message: { role: "user", content: "moron" },
  });
  assert.deepEqual(
    p.finish().map((m) => Option.getOrNull(m.model)),
    ["provider/one", "provider/two", "provider/one"],
  );
});

test("unanswered Claude and Codex turns don't inherit a previous response model", () => {
  const claude = new JsonlParser("claude", "fixture", new Diagnostics());
  claude.consume({ type: "user", uuid: "first", message: { role: "user", content: "shit" } });
  claude.consume({
    type: "assistant",
    message: { role: "assistant", content: [], model: "previous" },
  });
  claude.consume({ type: "user", uuid: "unanswered", message: { role: "user", content: "moron" } });
  assert.deepEqual(
    claude.finish().map((m) => Option.getOrNull(m.model)),
    ["previous", null],
  );
  const codex = new JsonlParser("codex", "fixture", new Diagnostics());
  codex.consume({ type: "session_meta", payload: { id: "s" } });
  codex.consume({ type: "event_msg", payload: { type: "user_message", message: "shit" } });
  codex.consume({ type: "turn_context", payload: { model: "previous" } });
  codex.consume({
    type: "response_item",
    payload: { type: "message", role: "user", content: "shit" },
  });
  codex.consume({ type: "event_msg", payload: { type: "user_message", message: "moron" } });
  assert.deepEqual(
    codex.finish().map((m) => Option.getOrNull(m.model)),
    ["previous", null],
  );
});

test("Codex also accepts context before its human event without carrying it into another turn", () => {
  const p = new JsonlParser("codex", "fixture", new Diagnostics());
  p.consume({ type: "session_meta", payload: { id: "s" } });
  p.consume({ type: "turn_context", payload: { model: "before" } });
  p.consume({ type: "event_msg", payload: { type: "user_message", message: "shit" } });
  p.consume({ type: "turn_context", payload: { model: "second" } });
  p.consume({ type: "event_msg", payload: { type: "user_message", message: "moron" } });
  assert.deepEqual(
    p.finish().map((m) => Option.getOrNull(m.model)),
    ["before", "second"],
  );
});

test("malformed database input has no successful files read and cannot resemble empty coverage", async () => {
  const root = await workspace();
  const database = join(root, "corrupt.db");
  await writeFile(database, "PRIVATE_SENTINEL_RAW this isn't SQLite");
  const report = await Effect.runPromise(
    TranscriptService.use((s) => s.scan({ paths: [`opencode=${database}`] })).pipe(
      Effect.provide(TranscriptService.layer),
    ),
  );
  assert.equal(report.status, "partial");
  assert.equal(report.filesRead, 0);
  assert.equal(report.totals.hits, 0);
  assert.equal(report.diagnostics[0]?.code, "unsupported-or-unreadable-database");
  assert.ok(!JSON.stringify(report).includes("PRIVATE_SENTINEL_RAW"));
});
