import type { Scope } from "effect";
import { Context, Effect, Layer, Option, Schema } from "effect";
import type { AnalysisResult } from "./cache.ts";
import { InferenceError, LocalModelError } from "./errors.ts";
import {
  definition,
  extractionPolicy,
  insultRule,
  Occurrences,
  occurrenceJsonSchema,
  profanityRule,
  resolveOccurrences,
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

function decodeOccurrences(value: unknown): typeof Occurrences.Type {
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
            session.resetChatHistory();
            const promptOptions = {
              grammar,
              temperature: 0,
              maxTokens: 512,
              budgets: { thoughtTokens: 0 },
              signal: bounded,
            };
            let response = await session.promptWithMeta(
              `Extract qualifying authored occurrences from this decoded target JSON string: ${JSON.stringify(text)}`,
              promptOptions,
            );
            let extracted = decodeOccurrences(grammar.parse(response.responseText));
            const predictions = {
              insult: result.answers.insult.value >= 0.5,
              profanity: result.answers.profanity.value >= 0.5,
            };
            const resolve = () => ({
              insults: resolveOccurrences(text, extracted.insults),
              profanity: resolveOccurrences(text, extracted.profanity),
            });
            let valid = true;
            try {
              resolve();
            } catch (error) {
              if (!(error instanceof RangeError)) throw error;
              valid = false;
            }
            if (
              !valid ||
              predictions.insult !== extracted.insults.length > 0 ||
              predictions.profanity !== extracted.profanity.length > 0
            ) {
              response = await session.promptWithMeta(
                `Review the target and your output against the category rules. Native classifier predictions: ${JSON.stringify(predictions)}. Those predictions may be wrong, not ground truth. Correct omissions, exclusions and occurrence ordinals. Count each SAME phrase case-insensitively and preserve the selected occurrence's spelling. Target JSON string: ${JSON.stringify(text)}`,
                promptOptions,
              );
              extracted = decodeOccurrences(grammar.parse(response.responseText));
            }
            if (!["eogToken", "stopGenerationTrigger"].includes(response.stopReason))
              throw InferenceError.create("context-or-generation-limit");
            const spans = resolve();
            if (
              predictions.insult !== spans.insults.length > 0 ||
              predictions.profanity !== spans.profanity.length > 0
            )
              throw InferenceError.create("invalid-extraction");
            return {
              version: 1,
              insultScore: result.answers.insult.value,
              profanityScore: result.answers.profanity.value,
              spans: [
                ...spans.insults.map((s) => ({ category: "insult" as const, ...s })),
                ...spans.profanity.map((s) => ({ category: "profanity" as const, ...s })),
              ],
            };
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
