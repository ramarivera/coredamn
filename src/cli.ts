import { Command, InvalidArgumentError, Option } from "commander";
import { Effect } from "effect";
import type { CommandName, CommandResult } from "./commands.ts";
import { CommandService } from "./commands.ts";
import { AGENTS, LANGUAGES } from "./types.ts";

const program = new Command()
  .name("coredamn")
  .description(
    "Count profanity and insults in your local coding-agent chats. Offline, human messages only.",
  )
  .version("0.1.2");
function date(value: string): string {
  const parsed = new Date(value);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new InvalidArgumentError("use a real UTC calendar date, YYYY-MM-DD");
  return value;
}
function common(command: Command): Command {
  return command
    .addOption(
      new Option("--agent <name...>", "select an agent; repeat to combine").choices(AGENTS),
    )
    .addOption(
      new Option(
        "--path <agent=path...>",
        "override an agent root or transcript file; repeat for multiple roots",
      ),
    )
    .option("--config <file>", "explicit JSON config, with paths relative to the config file")
    .option("--output <file>", "create a private report file; never overwrite an existing file");
}
async function dispatch(command: CommandName, options: unknown): Promise<void> {
  const failure = (error: { message: string }): CommandResult => ({
    stdout: "",
    stderr: `coredamn: ${error.message}\n`,
    exitCode: 2,
  });
  const result = await Effect.runPromise(
    CommandService.use((service) => service.execute(command, options)).pipe(
      Effect.provide(CommandService.layer),
      Effect.catchTags({
        ConfigurationError: (error) => Effect.succeed(failure(error)),
        ReportWriteError: (error) => Effect.succeed(failure(error)),
        LocalModelError: (error) => Effect.succeed(failure(error)),
        CacheAccessError: (error) => Effect.succeed(failure(error)),
        PresentationError: (error) => Effect.succeed(failure(error)),
      }),
    ),
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
common(
  program
    .command("discover")
    .description("Show resolved source paths and existence without reading chat content"),
)
  .option("--json", "emit source discovery as JSON")
  .action((options: unknown) => dispatch("discover", options));
function positive(value: string): number {
  const number = Number(value);
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(number))
    throw new InvalidArgumentError("use a positive whole number");
  return number;
}
function analytical(command: Command): Command {
  return common(command)
    .addOption(
      new Option("--detector <name>", "dictionary or opt-in local Qwen3.5 inference")
        .choices(["dictionary", "local"])
        .default("dictionary"),
    )
    .option("--model <gguf>", "existing local Qwen3.5 GGUF weights; never downloaded automatically")
    .option(
      "--cache-dir <directory>",
      "private inference cache, default XDG cache/coredamn/inference-v1",
    )
    .addOption(
      new Option("--gpu <backend>", "native inference backend")
        .choices(["auto", "vulkan", "cuda", "metal", "cpu"])
        .default("auto"),
    )
    .option("--context-size <tokens>", "native context, 4096 through 65536", positive, 4096)
    .option(
      "--max-messages <count>",
      "maximum new inference attempts per run; cache hits are free",
      positive,
      100,
    )
    .option(
      "--max-message-chars <count>",
      "larger messages are visibly skipped; never silently truncated",
      positive,
      6000,
    )
    .option("--quiet", "omit local inference progress from stderr")
    .addOption(
      new Option("--language <code...>", "lexicon language; repeat to combine").choices(LANGUAGES),
    )
    .option("--since <date>", "include dates on or after YYYY-MM-DD, UTC", date)
    .option("--until <date>", "include dates on or before YYYY-MM-DD, UTC", date);
}
analytical(
  program
    .command("scan")
    .description("Read human transcripts and report dictionary matches or local model occurrences"),
)
  .addOption(
    new Option("--format <format>", "report format; png requires --output")
      .choices(["terminal", "json", "html", "svg", "png"])
      .default("terminal"),
  )
  .option("--dry-run", "count eligible and cached work without running detection")
  .action((options: unknown) => dispatch("scan", options));
analytical(
  program
    .command("plan")
    .description("Count eligible and cached messages without detection or model initialization"),
)
  .addOption(
    new Option("--format <format>", "plan format")
      .choices(["terminal", "json"])
      .default("terminal"),
  )
  .action((options: unknown) => dispatch("plan", options));
analytical(
  program.command("tui").description("Explore the report in an interactive terminal dashboard"),
).action((options: unknown) => dispatch("tui", options));

await program.parseAsync().catch(() => {
  // Never print an unchecked native error that might contain transcript content.
  process.stderr.write("coredamn: Unexpected failure. Inputs were opened read-only.\n");
  process.exitCode = 2;
});
