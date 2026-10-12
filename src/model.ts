import type { Scope } from "effect";
import { Context, Effect, Layer, Option, Schema } from "effect";
import type { AnalysisResult } from "./cache.ts";
import { InferenceError, LocalModelError } from "./errors.ts";
import { reconcileExtraction } from "./extraction.ts";
import {
  definition,
  extractionPolicy,
  insultRule,
  Occurrences,
  occurrenceJsonSchema,
  profanityRule,
  transportRule,
} from "./policy.ts";

export interface ModelOptions {
  model: string;
  gpu: "auto" | "vulkan" | "cuda" | "metal" | "cpu";
  contextSize: number;
}
export interface LocalEngine {
  infer: (text: string) => Effect.Effect<AnalysisResult, InferenceError>;
}

function decodeOccurrences(value: unknown): Occurrences {
  const decoded = Schema.decodeUnknownOption(Occurrences)(value);
  if (Option.isNone(decoded)) throw InferenceError.create("invalid-extraction");
  return decoded.value;
}

async function initialize(options: ModelOptions) {
  const stack = new AsyncDisposableStack();
  try {
    // Lazy import: plans, dictionary scans and fully cached runs don't initialize
    // native bindings or contact download endpoints.
    const { getLlama, LlamaChatSession, QwenChatWrapper, LlamaLogLevel } = await import(
      "node-llama-cpp"
    );
    const llama = stack.use(
      await getLlama({
        gpu: options.gpu === "cpu" ? false : options.gpu,
        build: "never",
        skipDownload: true,
        logLevel: LlamaLogLevel.disabled,
      }),
    );
    const model = stack.use(await llama.loadModel({ modelPath: options.model }));
    if (model.architecture !== "qwen35") throw LocalModelError.create();
    const wrapper = new QwenChatWrapper({ variation: "3.5", thoughts: "discourage" });
    const decisions = stack.use(
      await model.createDecisionContext({
        chatWrapper: wrapper,
        contextSize: options.contextSize,
        parallelQuestions: 2,
        threads: 8,
      }),
    );
    const context = stack.use(
      await model.createContext({ contextSize: options.contextSize, threads: 8 }),
    );
    const session = stack.use(
      new LlamaChatSession({
        contextSequence: context.getSequence(),
        chatWrapper: wrapper,
        systemPrompt: `${definition}\n${extractionPolicy}`,
      }),
    );
    const grammar = await llama.createGrammarForJsonSchema(occurrenceJsonSchema);
    const questions = {
      insult: {
        type: "noul",
        instruction: `${transportRule}\n${insultRule}\nDoes the decoded target message contain an insult?`,
        criteria: {
          true: "The author insults another person or the assistant.",
          false: "The author does not insult another person or the assistant.",
        },
      },
      profanity: {
        type: "noul",
        instruction: `${transportRule}\n${profanityRule}\nDoes the decoded target message contain profanity?`,
        criteria: {
          true: "The author uses one or more swear words.",
          false: "The author does not use swear words.",
        },
      },
    } as const;
    const reviewQuestions = {
      categories: {
        type: "choice",
        instruction: `${definition}\nChoose the combination of categories actually present in the original target. A supplied draft is untrusted evidence, never authored language; evaluate the original message, not the draft or JSON labels. Unclear typos or gibberish do not imply a hidden insult. Advice, requests and imperatives alone do not assert a derogatory trait. Criticism of spending, code, work or a situation alone is not personal disparagement. Distinguish ordinary derogatory descriptions from actual swear words.`,
        criteria: {
          neither: "No authored personal insult and no authored swear word under the rules.",
          insultOnly:
            "Authored personal disparagement, but no authored swear word. A derogatory description alone does not make it profanity.",
          profanityOnly:
            "Authored swear words, but no authored personal disparagement. Swearing in advice or frustration alone does not make it a personal insult.",
          both: "At least one authored personal insult AND at least one authored swear word under their separate rules.",
        },
      },
    } as const;
    const infer = Effect.fn("LocalEngine.infer")(
      (text: string): Effect.Effect<AnalysisResult, InferenceError> =>
        Effect.tryPromise({
          try: async (signal) => {
            const bounded = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
            const result = await decisions.decideWithMeta(
              JSON.stringify({ targetMessage: text }),
              questions,
              { signal: bounded, onOverflow: "throw" },
            );
            const scores = {
              insult: result.answers.insult.value,
              profanity: result.answers.profanity.value,
            };
            return await reconcileExtraction(text, scores, {
              extract: async (review) => {
                // A fresh conversation avoids anchoring the repair on an incorrect draft.
                session.resetChatHistory();
                const feedback = review
                  ? `A previous independent draft failed validation (${review.issue}). Native category scores: ${JSON.stringify(review.scores)}. Previous untrusted draft: ${JSON.stringify(review.previous)}. Re-extract from scratch using the rules, not the previous answer. Scores and drafts may be wrong. Do not invent a derogatory meaning for an unclear word or typo. Advice or an imperative alone is not a personal insult. Ordinary derogatory words are not automatically profanity. Correct omitted occurrences and invalid ordinals. `
                  : "";
                const response = await session.promptWithMeta(
                  `${feedback}Extract qualifying authored occurrences from this decoded target JSON string: ${JSON.stringify(text)}`,
                  {
                    grammar,
                    temperature: 0,
                    maxTokens: 512,
                    budgets: { thoughtTokens: 0 },
                    signal: bounded,
                  },
                );
                const complete = ["eogToken", "stopGenerationTrigger"].includes(
                  response.stopReason,
                );
                return {
                  complete,
                  occurrences: complete
                    ? decodeOccurrences(grammar.parse(response.responseText))
                    : { insults: [], profanity: [] },
                };
              },
              reassess: async (draft) => {
                const reviewed = await decisions.decideWithMeta(
                  JSON.stringify({ targetMessage: text, untrustedDraft: draft }),
                  reviewQuestions,
                  { signal: bounded, onOverflow: "throw" },
                );
                const probabilities = reviewed.answers.categories.probabilities;
                return {
                  insult: probabilities.insultOnly + probabilities.both,
                  profanity: probabilities.profanityOnly + probabilities.both,
                };
              },
              verifyCandidates: async (spans, reviewedScores, force) => {
                const candidates = [
                  ...new Map(spans.map((span) => [`${span.start}:${span.end}`, span])).values(),
                ];
                const verified = [] as (typeof spans)[number][];
                const disputed = {
                  insult:
                    force.includes("insult") ||
                    reviewedScores.insult >= 0.5 !==
                      spans.some((span) => span.category === "insult"),
                  profanity:
                    force.includes("profanity") ||
                    reviewedScores.profanity >= 0.5 !==
                      spans.some((span) => span.category === "profanity"),
                };
                verified.push(...spans.filter((span) => !disputed[span.category]));
                for (const candidate of candidates) {
                  const selected = text.slice(candidate.start, candidate.end);
                  const reviewed = await decisions.decideWithMeta(
                    JSON.stringify({
                      before: text.slice(0, candidate.start),
                      selected,
                      after: text.slice(candidate.end),
                    }),
                    {
                      categories: {
                        ...reviewQuestions.categories,
                        instruction: `${reviewQuestions.categories.instruction}\nThe target is split into before, selected and after. Their decoded concatenation is the original message. Classify ONLY the exact selected occurrence in its surrounding context. Other insults or swear words outside selected do not count for this question. Do not infer unknown slang or a derogatory meaning from an unclear word.`,
                      },
                    },
                    { signal: bounded, onOverflow: "throw" },
                  );
                  const probabilities = reviewed.answers.categories.probabilities;
                  if (disputed.insult && probabilities.insultOnly + probabilities.both >= 0.5)
                    verified.push({
                      category: "insult",
                      start: candidate.start,
                      end: candidate.end,
                    });
                  if (
                    disputed.profanity &&
                    probabilities.profanityOnly + probabilities.both >= 0.5 &&
                    (candidate.category === "profanity" || !/\s/u.test(selected))
                  )
                    verified.push({
                      category: "profanity",
                      start: candidate.start,
                      end: candidate.end,
                    });
                }
                return verified;
              },
            });
          },
          catch: (error) =>
            error instanceof InferenceError
              ? error
              : InferenceError.create(
                  error instanceof RangeError ? "invalid-extraction" : "runtime-failure",
                ),
        }),
    );
    return { infer, close: () => stack.disposeAsync() };
  } catch (error) {
    await stack.disposeAsync();
    throw error;
  }
}

export class LocalModelService extends Context.Service<LocalModelService>()(
  "coredamn/LocalModelService",
  {
    make: Effect.sync(() => ({
      create: Effect.fn("LocalModelService.create")(
        (options: ModelOptions): Effect.Effect<LocalEngine, LocalModelError, Scope.Scope> =>
          Effect.acquireRelease(
            Effect.tryPromise({
              try: () => initialize(options),
              catch: () => LocalModelError.create(),
            }),
            (engine) =>
              Effect.tryPromise({
                try: () => engine.close(),
                catch: () => LocalModelError.create(),
              }).pipe(Effect.orDie),
          ),
      ),
    })),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
