import { existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Effect, Config as Environment, Option, Schema } from "effect";
import { ConfigurationError } from "./errors.ts";
import type { Agent, Config, Location } from "./types.ts";
import { AGENTS, agent, LANGUAGES } from "./types.ts";

const AgentSchema = Schema.Literals(AGENTS);
const LanguageSchema = Schema.Literals(LANGUAGES);
const Strings = Schema.Array(Schema.String.check(Schema.isMinLength(1)));
const ConfigSchema = Schema.Struct({
  agents: Schema.optionalKey(Schema.Array(AgentSchema).check(Schema.isMinLength(1))),
  paths: Schema.optionalKey(
    Schema.Struct({
      claude: Schema.optionalKey(Strings),
      codex: Schema.optionalKey(Strings),
      pi: Schema.optionalKey(Strings),
      omp: Schema.optionalKey(Strings),
      grok: Schema.optionalKey(Strings),
      opencode: Schema.optionalKey(Strings),
      cursor: Schema.optionalKey(Strings),
    }),
  ),
  terms: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        term: Schema.String.check(Schema.isMinLength(1)),
        category: Schema.Literals(["profanity", "insult"]),
        language: LanguageSchema,
      }),
    ),
  ),
  ignoreTerms: Schema.optionalKey(Strings),
  languages: Schema.optionalKey(Schema.Array(LanguageSchema).check(Schema.isMinLength(1))),
});
export function expandPath(path: string, home = homedir(), cwd = process.cwd()): string {
  if (!path.trim()) throw new Error("Paths must not be empty.");
  if (path === "~") return home;
  if (/^~[/\\]/u.test(path)) return resolve(home, path.slice(2));
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}
export const readConfig = Effect.fn("Configuration.read")(function* (
  path?: string,
): Effect.fn.Return<Config, ConfigurationError> {
  if (!path) return {};
  const resolved = expandPath(path);
  const text = yield* Effect.tryPromise({
    try: () => readFile(resolved, "utf8"),
    catch: () => new ConfigurationError({ message: "Couldn't read the configuration file." }),
  });
  const decoded = yield* Schema.decodeEffect(Schema.fromJsonString(ConfigSchema))(text, {
    onExcessProperty: "error",
  }).pipe(
    Effect.catchTag("SchemaError", () =>
      Effect.fail(
        new ConfigurationError({
          message:
            "Invalid config. Check docs/config.example.json for supported fields and values.",
        }),
      ),
    ),
  );
  const config: Config = {};
  if (decoded.agents) config.agents = [...decoded.agents];
  if (decoded.languages) config.languages = [...decoded.languages];
  if (decoded.terms) config.terms = [...decoded.terms];
  if (decoded.ignoreTerms) config.ignoreTerms = [...decoded.ignoreTerms];
  if (decoded.paths) {
    config.paths = {};
    for (const name of AGENTS) {
      const paths = decoded.paths[name];
      if (paths) {
        if (!paths.length || paths.some((p) => !p.trim()))
          return yield* new ConfigurationError({
            message: "Configured path arrays must contain nonempty paths.",
          });
        config.paths[name] = paths.map((p) => expandPath(p, homedir(), dirname(resolved)));
      }
    }
  }
  return config;
});
export const readEnvironment = Environment.all({
  CLAUDE_CONFIG_DIR: Environment.String("CLAUDE_CONFIG_DIR").pipe(Environment.withDefault("")),
  CODEX_HOME: Environment.String("CODEX_HOME").pipe(Environment.withDefault("")),
  PI_CODING_AGENT_SESSION_DIR: Environment.String("PI_CODING_AGENT_SESSION_DIR").pipe(
    Environment.withDefault(""),
  ),
  PI_CODING_AGENT_DIR: Environment.String("PI_CODING_AGENT_DIR").pipe(Environment.withDefault("")),
  PI_CONFIG_DIR: Environment.String("PI_CONFIG_DIR").pipe(Environment.withDefault("")),
  OMP_PROFILE: Environment.String("OMP_PROFILE").pipe(Environment.option),
  PI_PROFILE: Environment.String("PI_PROFILE").pipe(Environment.withDefault("")),
  GROK_HOME: Environment.String("GROK_HOME").pipe(Environment.withDefault("")),
  XDG_DATA_HOME: Environment.String("XDG_DATA_HOME").pipe(Environment.withDefault("")),
  XDG_CONFIG_HOME: Environment.String("XDG_CONFIG_HOME").pipe(Environment.withDefault("")),
  APPDATA: Environment.String("APPDATA").pipe(Environment.withDefault("")),
});
export interface ResolveOptions {
  agents?: string[];
  paths?: string[];
  config?: Config;
}
function ompProfile(value: string | undefined, strict = true): string {
  const name = value?.trim() ?? "";
  if (!name || name === "default") return "";
  const valid =
    /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(name) &&
    !name.endsWith(".") &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(name);
  if (!valid && strict)
    throw new Error(
      "Invalid OMP profile name. Use a valid profile or an explicit --path override.",
    );
  return valid ? name : "";
}
export function resolveLocations(
  options: ResolveOptions,
  env: NodeJS.ProcessEnv,
  home = homedir(),
  platform = process.platform,
): Omit<Location, "exists">[] {
  const config = options.config ?? {};
  const overrides: Partial<Record<Agent, string[]>> = {};
  for (const value of options.paths ?? []) {
    const split = value.indexOf("=");
    if (split < 1 || split === value.length - 1) throw new Error("--path expects agent=/path.");
    const name = agent(value.slice(0, split));
    overrides[name] ??= [];
    overrides[name].push(value.slice(split + 1));
  }
  const names = Object.keys(overrides).map(agent);
  const configuredNames = AGENTS.filter((name) => config.paths?.[name]);
  const selected = options.agents?.length
    ? options.agents.map(agent)
    : (config.agents ??
      (names.length ? names : configuredNames.length ? configuredNames : [...AGENTS]));
  for (const name of names)
    if (!selected.includes(name))
      throw new Error(`--path for '${name}' conflicts with selected agents.`);
  const xdgData = env.XDG_DATA_HOME || join(home, ".local", "share");
  const xdgConfig = env.XDG_CONFIG_HOME || join(home, ".config");
  const nativeOmp =
    selected.includes("omp") &&
    !overrides.omp &&
    !config.paths?.omp &&
    !env.PI_CODING_AGENT_SESSION_DIR;
  const profile = nativeOmp
    ? ompProfile(env.OMP_PROFILE !== undefined ? env.OMP_PROFILE : env.PI_PROFILE)
    : "";
  const ompRoot = profile
    ? join(home, env.PI_CONFIG_DIR || ".omp", "profiles", profile)
    : join(home, env.PI_CONFIG_DIR || ".omp");
  const ompData = profile ? join(xdgData, "omp", "profiles", profile) : join(xdgData, "omp");
  const legacyProfile = ompProfile(env.PI_PROFILE, false);
  const inheritedAgent = legacyProfile
    ? join(home, env.PI_CONFIG_DIR || ".omp", "profiles", legacyProfile, "agent")
    : undefined;
  const ompAgentOverride =
    !profile && env.PI_CODING_AGENT_DIR !== inheritedAgent ? env.PI_CODING_AGENT_DIR : undefined;
  const defaultAgent = join(ompRoot, "agent");
  const ompAgent = ompAgentOverride ? resolve(ompAgentOverride) : defaultAgent;
  const migrated =
    !!env.XDG_DATA_HOME &&
    (platform === "linux" || platform === "darwin") &&
    ompAgent === defaultAgent &&
    existsSync(ompData);
  const ompSessions = join(migrated ? ompData : ompAgent, "sessions");
  const defaults: Record<Agent, string[]> = {
    claude: [join(home, ".claude")],
    codex: [join(home, ".codex")],
    pi: [join(home, ".pi", "agent", "sessions")],
    omp: [ompSessions],
    grok: [join(home, ".grok", "sessions")],
    opencode: [join(xdgData, "opencode", "opencode.db")],
    cursor: [
      platform === "darwin"
        ? join(home, "Library", "Application Support", "Cursor")
        : platform === "win32"
          ? join(env.APPDATA || join(home, "AppData", "Roaming"), "Cursor")
          : join(xdgConfig, "Cursor"),
    ],
  };
  const environment: Partial<Record<Agent, [string, string]>> = {};
  if (env.CLAUDE_CONFIG_DIR) environment.claude = [env.CLAUDE_CONFIG_DIR, "CLAUDE_CONFIG_DIR"];
  if (env.CODEX_HOME) environment.codex = [env.CODEX_HOME, "CODEX_HOME"];
  if (env.PI_CODING_AGENT_SESSION_DIR) {
    environment.pi = [env.PI_CODING_AGENT_SESSION_DIR, "PI_CODING_AGENT_SESSION_DIR"];
    environment.omp = [env.PI_CODING_AGENT_SESSION_DIR, "PI_CODING_AGENT_SESSION_DIR"];
  } else {
    if (env.PI_CODING_AGENT_DIR)
      environment.pi = [join(env.PI_CODING_AGENT_DIR, "sessions"), "PI_CODING_AGENT_DIR"];
    if (env.PI_CONFIG_DIR || profile || ompAgentOverride || migrated)
      environment.omp = [ompSessions, "OMP config/profile/XDG"];
  }
  if (env.GROK_HOME) environment.grok = [join(env.GROK_HOME, "sessions"), "GROK_HOME"];
  return [...new Set(selected)].flatMap((name) => {
    const explicit = overrides[name] ?? config.paths?.[name];
    const configured = environment[name];
    const paths = explicit ?? (configured ? [configured[0]] : defaults[name]);
    const source = overrides[name]
      ? "--path"
      : config.paths?.[name]
        ? "config"
        : (configured?.[1] ?? "platform default");
    return [...new Set(paths.map((p) => expandPath(p, home)))].map((path) => ({
      agent: name,
      path,
      source,
      explicit: !!explicit || !!configured,
    }));
  });
}
export const discover = Effect.fn("Configuration.discover")(function* (
  options: ResolveOptions,
): Effect.fn.Return<Location[], ConfigurationError> {
  const values = yield* readEnvironment.pipe(
    Effect.catchTag("ConfigError", () =>
      Effect.fail(
        new ConfigurationError({ message: "Couldn't resolve agent environment configuration." }),
      ),
    ),
  );
  const env = { ...values, OMP_PROFILE: Option.getOrUndefined(values.OMP_PROFILE) };
  const locations = yield* Effect.try({
    try: () => resolveLocations(options, env),
    catch: (cause) =>
      new ConfigurationError({
        message: cause instanceof Error ? cause.message : "Invalid paths.",
      }),
  });
  return yield* Effect.tryPromise({
    try: () =>
      Promise.all(
        locations.map(async (location) => ({
          ...location,
          ...(await access(location.path).then(
            () => ({ exists: true }),
            (cause: unknown) => {
              const error = Schema.decodeUnknownOption(Schema.Struct({ code: Schema.String }))(
                cause,
              );
              const missing =
                Option.isSome(error) && ["ENOENT", "ENOTDIR"].includes(error.value.code);
              return { exists: false, ...(!missing ? { unreadable: true } : {}) };
            },
          )),
        })),
      ),
    catch: () => new ConfigurationError({ message: "Couldn't inspect configured locations." }),
  });
});
