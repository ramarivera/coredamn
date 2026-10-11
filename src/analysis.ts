import { basename } from "node:path";
import { Context, Effect, Layer, Option } from "effect";
import { fingerprint } from "./adapters/jsonl.ts";
import { Aggregator, type Filters } from "./aggregate.ts";
import { type AnalysisResult, CacheService, type ModelCache } from "./cache.ts";
import type { ResolveOptions } from "./config.ts";
import { type CacheAccessError, ConfigurationError, type LocalModelError } from "./errors.ts";
import { Diagnostics } from "./io.ts";
import { type LocalEngine, LocalModelService, type ModelOptions } from "./model.ts";
import { policyId } from "./policy.ts";
import { SourceService } from "./sources.ts";
import type { Agent, Detector, Message, Report, ScanPlan, Term } from "./types.ts";

export interface AnalysisRequest {
  mode?: "scan" | "plan";
  detector?: Detector;
  model?: string;
  cacheDirectory?: string;
  gpu?: ModelOptions["gpu"];
  contextSize?: number;
  maxMessages?: number;
  maxMessageChars?: number;
  progress?: (processed: number, cached: number, skipped: number) => void;
}
export class AnalysisService extends Context.Service<AnalysisService>()(
  "coredamn/AnalysisService",
  {
    make: Effect.gen(function* () {
      const sources = yield* SourceService;
      const caches = yield* CacheService;
      const models = yield* LocalModelService;
      return {
        run: Effect.fn("AnalysisService.run")(
          (
            options: ResolveOptions,
            filters: Filters,
            request: AnalysisRequest,
          ): Effect.Effect<
            { report: Report; plan: ScanPlan },
            ConfigurationError | LocalModelError | CacheAccessError
          > =>
            Effect.scoped(
              Effect.gen(function* () {
                const detector = request.detector ?? "dictionary";
                const planning = request.mode === "plan";
                const maxMessages = request.maxMessages ?? 100;
                const maxMessageChars = request.maxMessageChars ?? 6000;
                const contextSize = request.contextSize ?? 4096;
                const diagnostics = new Diagnostics();
                const aggregate = new Aggregator(options.config ?? {}, filters, diagnostics);
                const byAgent = new Map<Agent, { agent: Agent; messages: number; words: number }>();
                const pending = new Set<string>();
                const memo = new Map<string, AnalysisResult>();
                let eligible = 0,
                  words = 0,
                  cached = 0,
                  inferred = 0,
                  skipped = 0,
                  blocked = 0,
                  repeated = 0,
                  attempted = 0;
                let cache: ModelCache | undefined;
                let engine: LocalEngine | undefined;
                if (detector === "local") {
                  if (!request.model || !request.cacheDirectory)
                    return yield* new ConfigurationError({
                      message:
                        "Local analysis requires --model <existing-qwen3.5.gguf> and a cache directory.",
                    });
                  if (
                    filters.languages ||
                    options.config?.languages ||
                    options.config?.terms ||
                    options.config?.ignoreTerms
                  )
                    return yield* new ConfigurationError({
                      message:
                        "Language and dictionary term options apply only to --detector dictionary. Local analysis follows its contextual policy across languages.",
                    });
                  cache = yield* caches.open(
                    request.model,
                    request.cacheDirectory,
                    `${policyId}:context=${contextSize}`,
                  );
                }
                const filesRead = yield* sources.visit(
                  options,
                  Effect.fn("AnalysisService.consume")(function* (message: Message) {
                    const item = aggregate.prepare(message);
                    if (!item) return;
                    eligible++;
                    words += item.words;
                    const group = byAgent.get(message.agent) ?? {
                      agent: message.agent,
                      messages: 0,
                      words: 0,
                    };
                    group.messages++;
                    group.words += item.words;
                    byAgent.set(message.agent, group);
                    if (detector === "dictionary") {
                      aggregate.record(item, planning ? [] : aggregate.dictionary(item.text));
                      return;
                    }
                    if (!cache) return;
                    if (item.text.length > maxMessageChars) {
                      blocked++;
                      skipped++;
                      diagnostics.add(message.agent, "message-exceeds-character-limit");
                      return;
                    }
                    const key = fingerprint(item.text);
                    let result = memo.get(key);
                    if (result) {
                      cached++;
                      repeated++;
                    } else {
                      const entry = yield* cache.get(item.text);
                      if (entry.invalid) diagnostics.add(message.agent, "invalid-cache-entry");
                      result = Option.getOrUndefined(entry.result);
                      if (result) {
                        cached++;
                        memo.set(key, result);
                      }
                    }
                    if (!result) {
                      if (pending.has(key)) repeated++;
                      pending.add(key);
                      if (planning) {
                        aggregate.record(item, []);
                        return;
                      }
                      if (attempted >= maxMessages) {
                        skipped++;
                        diagnostics.add(message.agent, "inference-limit-reached");
                        return;
                      }
                      attempted++;
                      if (!engine)
                        engine = yield* models.create({
                          model: cache.identity.path,
                          gpu: request.gpu ?? "auto",
                          contextSize,
                        });
                      const outcome = yield* engine.infer(item.text).pipe(
                        Effect.asSome,
                        Effect.catchTag("InferenceError", (error) => {
                          diagnostics.add(message.agent, error.reason);
                          return Effect.succeed(Option.none<AnalysisResult>());
                        }),
                      );
                      if (Option.isNone(outcome)) {
                        skipped++;
                        request.progress?.(inferred, cached, skipped);
                        return;
                      }
                      result = outcome.value;
                      yield* cache.put(item.text, result);
                      memo.set(key, result);
                      inferred++;
                    }
                    const hits: Term[] = result.spans.map((span) => ({
                      term: item.text.slice(span.start, span.end),
                      category: span.category,
                      language: "und",
                    }));
                    aggregate.record(item, planning ? [] : hits);
                    request.progress?.(inferred, cached, skipped);
                  }),
                  diagnostics,
                );
                const report = aggregate.finish(filesRead);
                report.analysis = {
                  detector,
                  policy:
                    detector === "local"
                      ? `qwen35-occurrences-${policyId.slice(0, 12)}`
                      : report.ruleset,
                  eligibleMessages: eligible,
                  cachedMessages: cached,
                  inferredMessages: inferred,
                  skippedMessages: skipped,
                  ...(request.model ? { model: basename(request.model) } : {}),
                };
                if (detector === "local") report.ruleset = report.analysis.policy;
                const selected = Math.min(pending.size, maxMessages);
                const plan: ScanPlan = {
                  kind: "plan",
                  status: report.status,
                  detector,
                  eligibleMessages: eligible,
                  words,
                  filesRead,
                  duplicatesRemoved: report.duplicatesRemoved,
                  byAgent: [...byAgent.values()],
                  cachedMessages: cached,
                  pendingMessages: detector === "local" ? pending.size : 0,
                  blockedMessages: blocked,
                  selectedMessages: selected,
                  repeatedInputs: repeated,
                  estimatedSeconds: detector === "local" ? selected * 8.513 : null,
                  diagnostics: report.diagnostics,
                };
                return { report, plan };
              }),
            ),
        ),
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(Layer.mergeAll(SourceService.layer, CacheService.layer, LocalModelService.layer)),
  );
}
