import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Layer, Option } from "effect";
import { type AnalysisRequest, AnalysisService } from "../src/analysis.ts";
import type { AnalysisResult } from "../src/cache.ts";
import { CacheService } from "../src/cache.ts";
import { InferenceError } from "../src/errors.ts";
import { LocalModelService } from "../src/model.ts";
import { resolveOccurrences } from "../src/policy.ts";
import { SourceService } from "../src/sources.ts";
import { when, workspace } from "./helpers.ts";

async function fixture(texts: readonly string[]) {
  const root = await workspace();
  const source = join(root, "session.jsonl"),
    model = join(root, "model.gguf"),
    cacheDirectory = join(root, "cache");
  await writeFile(
    model,
    "GGUF synthetic model identity; native inference is replaced in this test",
  );
  await writeFile(
    source,
    texts
      .map((content, id) =>
        JSON.stringify({
          type: "user",
          uuid: String(id),
          timestamp: when,
          message: { role: "user", content },
        }),
      )
      .join("\n"),
  );
  let starts = 0,
    closes = 0,
    calls = 0;
  const fakeModels = Layer.succeed(LocalModelService, {
    create: () =>
      Effect.acquireRelease(
        Effect.sync(() => {
          starts++;
          return {
            infer: (text: string) => {
              calls++;
              if (text === "fail this input")
                return Effect.fail(InferenceError.create("runtime-failure"));
              const start = text.indexOf("clownshoes");
              const result: AnalysisResult = {
                version: 1,
                insultScore: start >= 0 ? 0.9 : 0.1,
                profanityScore: 0.1,
                spans:
                  start >= 0
                    ? [{ category: "insult", start, end: start + "clownshoes".length }]
                    : [],
              };
              return Effect.succeed(result);
            },
          };
        }),
        () =>
          Effect.sync(() => {
            closes++;
          }),
      ),
  });
  const layer = Layer.effect(AnalysisService, AnalysisService.make).pipe(
    Layer.provide(Layer.mergeAll(SourceService.layer, CacheService.layer, fakeModels)),
  );
  const run = (request: AnalysisRequest = {}) =>
    Effect.runPromise(
      AnalysisService.use((s) =>
        s.run(
          { paths: [`claude=${source}`] },
          {},
          { detector: "local", model, cacheDirectory, ...request },
        ),
      ).pipe(Effect.provide(layer)),
    );
  return { run, root, model, cacheDirectory, stats: () => ({ starts, closes, calls }) };
}

test("plans count unique uncached inputs and blocked messages without native initialization or cache writes", async () => {
  const f = await fixture(["hello friend", "hello friend", "x".repeat(6100)]);
  const { plan } = await f.run({ mode: "plan" });
  assert.equal(plan.eligibleMessages, 3);
  assert.equal(plan.pendingMessages, 1);
  assert.equal(plan.repeatedInputs, 1);
  assert.equal(plan.blockedMessages, 1);
  assert.equal(plan.estimatedSeconds, 8.513);
  assert.deepEqual(f.stats(), { starts: 0, closes: 0, calls: 0 });
  assert.ok(!(await readdir(f.root)).includes("cache"));
});

test("contextual scans analyze dictionary misses, cache only offsets/scores, and replay without native initialization", async () => {
  const f = await fixture([
    "PRIVATE_SOURCE_SENTINEL you are clownshoes",
    "hello friend",
    "hello friend",
  ]);
  const first = await f.run();
  assert.equal(first.report.totals.messages, 3);
  assert.equal(first.report.totals.insults, 1);
  assert.equal(first.report.analysis?.inferredMessages, 2);
  assert.equal(first.report.analysis?.cachedMessages, 1);
  assert.deepEqual(f.stats(), { starts: 1, closes: 1, calls: 2 });
  const second = await f.run();
  assert.equal(second.report.analysis?.cachedMessages, 3);
  assert.equal(second.report.analysis?.inferredMessages, 0);
  assert.deepEqual(second.report.totals, first.report.totals);
  assert.deepEqual(f.stats(), { starts: 1, closes: 1, calls: 2 });
  for (const filename of await readdir(f.cacheDirectory)) {
    const entry = await readFile(join(f.cacheDirectory, filename), "utf8");
    assert.ok(!entry.includes("PRIVATE_SOURCE_SENTINEL"));
    assert.ok(!entry.includes("clownshoes"));
    assert.ok(!entry.includes(f.model));
  }
  const plan = (await f.run({ mode: "plan" })).plan;
  assert.equal(plan.pendingMessages, 0);
  assert.equal(plan.cachedMessages, 3);
  assert.equal(plan.estimatedSeconds, 0);
  await f.run({ contextSize: 8192 });
  assert.equal(f.stats().calls, 4, "context changes must invalidate cached results");
  await writeFile(f.model, "GGUF different model weights");
  await f.run();
  assert.equal(f.stats().calls, 6, "changed weights must invalidate cached results");
});

test("bounded scans resume new work and close model resources after failures", async () => {
  const f = await fixture(["you are clownshoes", "hello friend"]);
  const first = await f.run({ maxMessages: 1 });
  assert.equal(first.report.status, "partial");
  assert.equal(first.report.analysis?.skippedMessages, 1);
  const second = await f.run({ maxMessages: 1 });
  assert.equal(second.report.status, "complete");
  assert.equal(second.report.analysis?.cachedMessages, 1);
  assert.equal(second.report.analysis?.inferredMessages, 1);
  assert.equal(f.stats().starts, f.stats().closes);
  const bad = await fixture(["fail this input"]);
  const failed = await bad.run();
  assert.equal(failed.report.status, "partial");
  assert.equal(failed.report.totals.messages, 0);
  assert.equal(failed.report.analysis?.skippedMessages, 1);
  assert.deepEqual(bad.stats(), { starts: 1, closes: 1, calls: 1 });
});

test("invalid cached spans are rejected and policy namespaces don't cross", async () => {
  const f = await fixture(["you are clownshoes"]);
  await f.run();
  const filename = (await readdir(f.cacheDirectory))[0];
  assert.ok(filename);
  await writeFile(
    join(f.cacheDirectory, filename),
    JSON.stringify({
      version: 1,
      insultScore: 0.9,
      profanityScore: 0.1,
      spans: [{ category: "insult", start: 0, end: 99999 }],
    }),
  );
  const retry = await f.run();
  assert.equal(retry.report.totals.insults, 1);
  assert.equal(retry.report.analysis?.inferredMessages, 1);
  assert.ok(retry.report.diagnostics.some((d) => d.code === "invalid-cache-entry"));
  await Effect.runPromise(
    CacheService.use((cache) =>
      Effect.gen(function* () {
        const a = yield* cache.open(f.model, f.cacheDirectory, "policy-a");
        const b = yield* cache.open(f.model, f.cacheDirectory, "policy-b");
        yield* a.put("hello", { version: 1, insultScore: 0.1, profanityScore: 0.1, spans: [] });
        assert.ok(Option.isNone((yield* b.get("hello")).result));
      }),
    ).pipe(Effect.provide(CacheService.layer)),
  );
});

test("occurrence extraction distinguishes quoted/repeated terms, case and Unicode offsets", () => {
  const text = '😀 "idiot" then IDIOT and idiot';
  assert.deepEqual(
    resolveOccurrences(text, [
      ["IDIOT", 2],
      ["idiot", 3],
    ]),
    [
      { start: 16, end: 21 },
      { start: 26, end: 31 },
    ],
  );
  assert.throws(() => resolveOccurrences(text, [["idiot", 2]]), RangeError);
  assert.throws(
    () =>
      resolveOccurrences(text, [
        ["IDIOT", 2],
        ["IDIOT", 2],
      ]),
    RangeError,
  );
});
