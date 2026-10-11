import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Config as Environment, Layer, Schema } from "effect";
import type { AnalysisRequest } from "./analysis.ts";
import { expandPath, readConfig } from "./config.ts";
import {
  type CacheAccessError,
  ConfigurationError,
  type LocalModelError,
  PresentationError,
  ReportWriteError,
} from "./errors.ts";
import { PresentationService, terminalPlan } from "./presentation.ts";
import { html, terminal } from "./report.ts";
import { TranscriptService } from "./scan.ts";
import { AGENTS, LANGUAGES } from "./types.ts";
import { shareCard } from "./visuals.ts";

export const CommandOptions = Schema.Struct({
  agent: Schema.optionalKey(Schema.Array(Schema.Literals(AGENTS))),
  path: Schema.optionalKey(Schema.Array(Schema.String)),
  config: Schema.optionalKey(Schema.String),
  format: Schema.optionalKey(Schema.Literals(["terminal", "json", "html", "svg", "png"])),
  output: Schema.optionalKey(Schema.String),
  json: Schema.optionalKey(Schema.Boolean),
  since: Schema.optionalKey(Schema.String),
  until: Schema.optionalKey(Schema.String),
  language: Schema.optionalKey(Schema.Array(Schema.Literals(LANGUAGES))),
  dryRun: Schema.optionalKey(Schema.Boolean),
  detector: Schema.optionalKey(Schema.Literals(["dictionary", "local"])),
  model: Schema.optionalKey(Schema.String),
  cacheDir: Schema.optionalKey(Schema.String),
  gpu: Schema.optionalKey(Schema.Literals(["auto", "vulkan", "cuda", "metal", "cpu"])),
  contextSize: Schema.optionalKey(
    Schema.Finite.check(Schema.isInt(), Schema.isBetween({ minimum: 4096, maximum: 65536 })),
  ),
  maxMessages: Schema.optionalKey(Schema.Finite.check(Schema.isInt(), Schema.isGreaterThan(0))),
  maxMessageChars: Schema.optionalKey(Schema.Finite.check(Schema.isInt(), Schema.isGreaterThan(0))),
  quiet: Schema.optionalKey(Schema.Boolean),
});
export type CommandName = "discover" | "scan" | "plan" | "tui";
type CommandError =
  | ConfigurationError
  | ReportWriteError
  | LocalModelError
  | CacheAccessError
  | PresentationError;
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const execute = Effect.fn("Coredamn.execute")(function* (
  service: typeof TranscriptService.Service,
  presentation: typeof PresentationService.Service,
  command: CommandName,
  raw: unknown,
): Effect.fn.Return<CommandResult, CommandError> {
  const options = yield* Schema.decodeUnknownEffect(CommandOptions)(raw).pipe(
    Effect.catchTag("SchemaError", () =>
      Effect.fail(
        new ConfigurationError({ message: "Invalid command options. Run coredamn --help." }),
      ),
    ),
  );
  if (options.since && options.until && options.since > options.until)
    return yield* new ConfigurationError({ message: "--since must be on or before --until." });
  const config = yield* readConfig(options.config);
  const input = {
    config,
    ...(options.agent ? { agents: [...options.agent] } : {}),
    ...(options.path ? { paths: [...options.path] } : {}),
  };
  const planning = command === "plan" || options.dryRun;
  if (planning && options.format && !["terminal", "json"].includes(options.format))
    return yield* new ConfigurationError({
      message: "A count-only plan supports --format terminal or json.",
    });
  if (options.format === "png" && !options.output)
    return yield* new ConfigurationError({
      message: "PNG export requires --output <new-file.png>.",
    });
  if (command === "tui" && options.output)
    return yield* new ConfigurationError({
      message: "The TUI doesn't write --output files. Use scan --format html or png.",
    });
  if (command === "tui" && (!process.stdin.isTTY || !process.stdout.isTTY))
    return yield* new PresentationError({
      message:
        "The TUI needs an interactive terminal. Use scan --format terminal, html or json when piping output.",
    });
  let text: string | Uint8Array;
  let exitCode = 0;
  if (command === "discover") {
    const locations = yield* service.discover(input);
    text = options.json
      ? `${JSON.stringify(locations, null, 2)}\n`
      : `${locations.map((l) => `${l.agent}: ${l.exists ? "found" : "missing"} (${l.source})\n  ${l.path}`).join("\n")}\n`;
  } else {
    const filters = {
      ...(options.since ? { since: options.since } : {}),
      ...(options.until ? { until: options.until } : {}),
      ...(options.language ? { languages: [...options.language] } : {}),
    };
    const cacheRoot = options.cacheDir
      ? ""
      : yield* Environment.String("XDG_CACHE_HOME").pipe(
          Environment.withDefault(join(homedir(), ".cache")),
          Effect.catchTag("ConfigError", () =>
            Effect.fail(
              new ConfigurationError({
                message: "Couldn't resolve XDG_CACHE_HOME. Use a valid --cache-dir.",
              }),
            ),
          ),
        );
    const request: AnalysisRequest = {
      detector: options.detector ?? "dictionary",
      cacheDirectory: options.cacheDir
        ? expandPath(options.cacheDir)
        : join(cacheRoot || join(homedir(), ".cache"), "coredamn", "inference-v1"),
      ...(options.model ? { model: expandPath(options.model) } : {}),
      ...(options.gpu ? { gpu: options.gpu } : {}),
      ...(options.contextSize ? { contextSize: options.contextSize } : {}),
      ...(options.maxMessages ? { maxMessages: options.maxMessages } : {}),
      ...(options.maxMessageChars ? { maxMessageChars: options.maxMessageChars } : {}),
      ...(!options.quiet && !planning && options.detector === "local"
        ? {
            progress: (inferred: number, cached: number, skipped: number) =>
              process.stderr.write(
                `coredamn: ${inferred} inferred, ${cached} cached, ${skipped} skipped\n`,
              ),
          }
        : {}),
    };
    if (planning) {
      const plan = yield* service.plan(input, filters, request);
      text = options.format === "json" ? `${JSON.stringify(plan, null, 2)}\n` : terminalPlan(plan);
      exitCode = plan.status === "partial" ? 2 : !plan.eligibleMessages ? 1 : 0;
    } else {
      const report = yield* service.scan(input, filters, request);
      if (command === "tui") {
        yield* presentation.browse(report);
        text = "";
      } else
        text =
          options.format === "png"
            ? yield* presentation.png(report)
            : options.format === "svg"
              ? shareCard(report)
              : options.format === "html"
                ? html(report)
                : options.format === "json"
                  ? `${JSON.stringify(report, null, 2)}\n`
                  : terminal(report);
      exitCode = report.status === "partial" ? 2 : report.status === "empty" ? 1 : 0;
    }
  }
  if (options.output) {
    const output = expandPath(options.output);
    yield* Effect.tryPromise({
      try: () => writeFile(output, text, { encoding: "utf8", flag: "wx", mode: 0o600 }),
      catch: () => ReportWriteError.create(),
    });
    return { stdout: "", stderr: "Report written.\n", exitCode };
  }
  return { stdout: typeof text === "string" ? text : "", stderr: "", exitCode };
});

export class CommandService extends Context.Service<CommandService>()("coredamn/CommandService", {
  make: Effect.gen(function* () {
    const transcripts = yield* TranscriptService;
    const presentation = yield* PresentationService;
    return {
      execute: Effect.fn("CommandService.execute")(
        (command: CommandName, raw: unknown): Effect.Effect<CommandResult, CommandError> =>
          execute(transcripts, presentation, command, raw),
      ),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(Layer.mergeAll(TranscriptService.layer, PresentationService.layer)),
  );
}
