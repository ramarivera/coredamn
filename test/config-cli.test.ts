import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import { readConfig, resolveLocations } from "../src/config.ts";
import { TranscriptService } from "../src/scan.ts";
import { fixtureAll, jsonl, millis, when, workspace } from "./helpers.ts";

const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["src/cli.ts", ...args], { encoding: "utf8" });
const Report = Schema.Struct({
  status: Schema.String,
  totals: Schema.Struct({ messages: Schema.Finite, hits: Schema.Finite }),
});
const decodeReport = Schema.decodeSync(Schema.fromJsonString(Report));

test("CLI plans are count-only and unsafe format/terminal combinations fail before reading inputs", async () => {
  const root = await workspace();
  await fixtureAll(root);
  const args = ["--path", `claude=${join(root, "claude")}`];
  const Plan = Schema.Struct({
    kind: Schema.Literal("plan"),
    eligibleMessages: Schema.Finite,
    words: Schema.Finite,
  });
  for (const command of [["plan"], ["scan", "--dry-run"]]) {
    const result = cli(...command, ...args, "--format", "json");
    assert.equal(result.status, 0, result.stderr);
    const plan = Schema.decodeSync(Schema.fromJsonString(Plan))(result.stdout);
    assert.equal(plan.eligibleMessages, 2);
    assert.ok(plan.words > 0);
    assert.ok(!result.stdout.includes('"hits"'));
    assert.ok(!result.stdout.includes("PRIVATE_SENTINEL_RAW"));
  }
  assert.match(cli("tui").stderr, /interactive terminal/u);
  assert.match(cli("scan", "--format", "png").stderr, /requires --output/u);
  assert.match(cli("scan", "--dry-run", "--format", "html").stderr, /count-only plan/u);
  assert.equal(cli("scan", "--max-messages", "-1").status, 1);
  assert.equal(cli("scan", "--context-size", "10").status, 2);
});

test("CLI uses Commander choices, repeated options and actual JSON report output", async () => {
  const root = await workspace();
  await fixtureAll(root);
  const result = cli(
    "scan",
    "--agent",
    "claude",
    "--agent",
    "codex",
    "--path",
    `claude=${join(root, "claude")}`,
    "--path",
    `codex=${join(root, "codex")}`,
    "--format",
    "json",
  );
  assert.equal(result.status, 0, result.stderr);
  const report = decodeReport(result.stdout);
  assert.equal(report.totals.messages, 4);
  assert.equal(report.totals.hits, 4);
  const invalid = cli("scan", "--agent", "made-up");
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Allowed choices/u);
  assert.equal(cli("scan", "--since", "2026-02-30").status, 1);
  assert.equal(cli("scan", "--since", "9999-99-99").status, 1);
  assert.equal(cli("scan", "--since", "2026-10-12", "--until", "2026-10-11").status, 2);
});

test("CLI create-only outputs protect existing reports and inputs", async () => {
  const root = await workspace();
  await fixtureAll(root);
  const output = join(root, "report.html");
  const args = [
    "scan",
    "--path",
    `claude=${join(root, "claude")}`,
    "--format",
    "html",
    "--output",
    output,
  ];
  const result = cli(...args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  const original = await readFile(output, "utf8");
  assert.match(original, /<!doctype html>/u);
  assert.equal(cli(...args).status, 2);
  assert.equal(await readFile(output, "utf8"), original);
  const input = join(root, "claude", "projects", "project", "session.jsonl");
  const before = await readFile(input);
  assert.equal(cli("scan", "--path", `claude=${input}`, "--output", input).status, 2);
  assert.deepEqual(await readFile(input), before);
});

test("metadata-only discovery doesn't parse malformed transcript contents", async () => {
  const root = await workspace();
  const source = join(root, "broken.jsonl");
  await writeFile(source, "THIS IS NOT JSON");
  const result = cli("discover", "--path", `claude=${source}`, "--json");
  assert.equal(result.status, 0, result.stderr);
  const rows = Schema.decodeSync(
    Schema.fromJsonString(
      Schema.Array(
        Schema.Struct({ agent: Schema.String, exists: Schema.Boolean, path: Schema.String }),
      ),
    ),
  )(result.stdout);
  assert.equal(rows[0]?.exists, true);
  assert.equal(rows[0]?.path, source);
  const scan = cli("scan", "--path", `claude=${source}`, "--format", "json");
  assert.equal(scan.status, 2);
  assert.equal(decodeReport(scan.stdout).status, "partial");
});

test("config is schema validated, relative to its file, with strict unknown keys", async () => {
  const root = await workspace();
  await writeFile(
    join(root, "config.json"),
    JSON.stringify({ paths: { claude: ["./transcripts"] }, ignoreTerms: ["damn"] }),
  );
  const config = await Effect.runPromise(readConfig(join(root, "config.json")));
  assert.deepEqual(config.paths?.claude, [join(root, "transcripts")]);
  await writeFile(join(root, "bad.json"), JSON.stringify({ paths: { claude: [42] } }));
  const bad = await Effect.runPromise(Effect.result(readConfig(join(root, "bad.json"))));
  assert.equal(bad._tag, "Failure");
  await writeFile(join(root, "bad.json"), JSON.stringify({ typo: true }));
  const typo = await Effect.runPromise(Effect.result(readConfig(join(root, "bad.json"))));
  assert.equal(typo._tag, "Failure");
});

test("path precedence respects custom Claude, Grok, Pi and OMP environments", async () => {
  const home = await workspace();
  const env = {
    CLAUDE_CONFIG_DIR: join(home, "custom-claude"),
    GROK_HOME: join(home, "custom-grok"),
    PI_CODING_AGENT_DIR: join(home, "shared-agent"),
  };
  const resolved = resolveLocations({}, env, home);
  assert.equal(resolved.find((l) => l.agent === "claude")?.path, env.CLAUDE_CONFIG_DIR);
  assert.equal(resolved.find((l) => l.agent === "grok")?.path, join(env.GROK_HOME, "sessions"));
  assert.equal(
    resolved.find((l) => l.agent === "pi")?.path,
    join(env.PI_CODING_AGENT_DIR, "sessions"),
  );
  assert.equal(
    resolved.find((l) => l.agent === "omp")?.path,
    join(env.PI_CODING_AGENT_DIR, "sessions"),
  );
  const explicit = resolveLocations(
    { paths: ["claude=./cli"], config: { paths: { claude: ["./config"] } } },
    env,
    home,
  );
  assert.equal(explicit[0]?.source, "--path");
  assert.equal(explicit.length, 1);
  const session = resolveLocations(
    { agents: ["pi", "omp"] },
    { ...env, PI_CODING_AGENT_SESSION_DIR: join(home, "sessions") },
    home,
  );
  assert.ok(session.every((l) => l.path === join(home, "sessions")));
  const named = resolveLocations(
    { agents: ["omp"] },
    { ...env, OMP_PROFILE: "work", PI_CONFIG_DIR: ".other" },
    home,
    "linux",
  );
  assert.equal(named[0]?.path, join(home, ".other", "profiles", "work", "agent", "sessions"));
  const xdg = join(home, "data");
  await mkdir(join(xdg, "omp", "profiles", "work"), { recursive: true });
  assert.equal(
    resolveLocations(
      { agents: ["omp"] },
      { OMP_PROFILE: "work", XDG_DATA_HOME: xdg },
      home,
      "linux",
    )[0]?.path,
    join(xdg, "omp", "profiles", "work", "sessions"),
  );
  assert.equal(
    resolveLocations({ agents: ["omp"] }, { OMP_PROFILE: "", PI_PROFILE: "work" }, home, "linux")[0]
      ?.path,
    join(home, ".omp", "agent", "sessions"),
  );
});

test("OpenCode current session_message schema excludes synthetic context and tracks replies", async () => {
  const root = await workspace();
  const path = join(root, "current.db");
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE session_message(id TEXT,session_id TEXT,type TEXT,seq INTEGER,time_created INTEGER,data TEXT)",
  );
  const insert = db.prepare("INSERT INTO session_message VALUES(?,?,?,?,?,?)");
  insert.run(
    "u1",
    "s",
    "user",
    1,
    millis,
    JSON.stringify({ text: "shit fix it", time: { created: millis } }),
  );
  insert.run(
    "s1",
    "s",
    "synthetic",
    2,
    millis,
    JSON.stringify({ text: "fuck idiot", time: { created: millis } }),
  );
  insert.run(
    "a1",
    "s",
    "assistant",
    3,
    millis,
    JSON.stringify({ model: { id: "first", providerID: "provider" } }),
  );
  insert.run(
    "u2",
    "s",
    "user",
    4,
    millis,
    JSON.stringify({ text: "moron", time: { created: millis } }),
  );
  insert.run(
    "a2",
    "s",
    "assistant",
    5,
    millis,
    JSON.stringify({ model: { id: "second", providerID: "provider" } }),
  );
  db.close();
  const report = await Effect.runPromise(
    TranscriptService.use((s) => s.scan({ paths: [`opencode=${path}`] })).pipe(
      Effect.provide(TranscriptService.layer),
    ),
  );
  assert.equal(report.status, "complete");
  assert.equal(report.totals.hits, 2);
  assert.equal(report.totals.messages, 2);
  assert.deepEqual(
    report.byModel.map((r) => r.label),
    ["opencode / provider/first", "opencode / provider/second"],
  );
});

test("Cursor header references and workspace classic chats decode separately", async () => {
  const root = await workspace();
  const global = join(root, "User", "globalStorage", "state.vscdb");
  await mkdir(dirname(global), { recursive: true });
  const db = new DatabaseSync(global);
  db.exec("CREATE TABLE cursorDiskKV(key TEXT,value TEXT)");
  const insert = db.prepare("INSERT INTO cursorDiskKV VALUES(?,?)");
  insert.run(
    "composerData:session",
    JSON.stringify({
      composerId: "session",
      fullConversationHeadersOnly: [{ bubbleId: "bubble" }],
    }),
  );
  insert.run(
    "bubbleId:session:bubble",
    JSON.stringify({ type: 1, text: "shit", createdAt: millis }),
  );
  db.close();
  const classic = join(root, "User", "workspaceStorage", "project", "state.vscdb");
  await mkdir(dirname(classic), { recursive: true });
  const workspaceDb = new DatabaseSync(classic);
  workspaceDb.exec("CREATE TABLE ItemTable(key TEXT,value TEXT)");
  workspaceDb
    .prepare("INSERT INTO ItemTable VALUES(?,?)")
    .run(
      "workbench.panel.aichat.view.aichat.chatdata",
      JSON.stringify({ tabs: [{ id: "tab", bubbles: [{ type: "user", text: "idiot" }] }] }),
    );
  workspaceDb.close();
  const report = await Effect.runPromise(
    TranscriptService.use((s) => s.scan({ paths: [`cursor=${root}`] })).pipe(
      Effect.provide(TranscriptService.layer),
    ),
  );
  assert.equal(report.totals.messages, 2);
  assert.equal(report.unknownDates, 1);
  assert.equal(report.totals.hits, 2);
});

test("model backfill never crosses an OMP branch", async () => {
  const root = await workspace();
  const path = join(root, "branch.jsonl");
  await jsonl(path, [
    { type: "session", id: "s" },
    { type: "model_change", id: "model", parentId: null, model: "provider/base" },
    {
      type: "message",
      id: "left",
      parentId: "model",
      timestamp: when,
      message: { role: "user", content: "shit" },
    },
    {
      type: "message",
      id: "right",
      parentId: "model",
      timestamp: when,
      message: { role: "user", content: "moron" },
    },
    {
      type: "message",
      id: "reply",
      parentId: "right",
      message: { role: "assistant", provider: "provider", model: "response" },
    },
  ]);
  const report = await Effect.runPromise(
    TranscriptService.use((s) => s.scan({ paths: [`omp=${path}`] })).pipe(
      Effect.provide(TranscriptService.layer),
    ),
  );
  assert.equal(report.byModel.find((r) => r.label === "omp / provider/base")?.messages, 1);
  assert.equal(report.byModel.find((r) => r.label === "omp / provider/response")?.messages, 1);
});

test("OMP follows upstream migration gating, profile normalization and inherited-profile cleanup", async () => {
  const home = await workspace();
  await mkdir(join(home, ".local", "share", "omp"), { recursive: true });
  const resolve = (env: NodeJS.ProcessEnv) =>
    resolveLocations({ agents: ["omp"] }, env, home, "linux")[0]?.path;
  assert.equal(
    resolve({}),
    join(home, ".omp", "agent", "sessions"),
    "upstream only uses an explicitly set XDG_DATA_HOME",
  );
  assert.equal(resolve({ OMP_PROFILE: " default " }), join(home, ".omp", "agent", "sessions"));
  assert.equal(
    resolve({ OMP_PROFILE: " work " }),
    join(home, ".omp", "profiles", "work", "agent", "sessions"),
  );
  const data = join(home, "data");
  await mkdir(join(data, "omp"), { recursive: true });
  assert.equal(
    resolve({ XDG_DATA_HOME: data, PI_CODING_AGENT_DIR: join(home, ".omp", "agent") }),
    join(data, "omp", "sessions"),
  );
  assert.equal(
    resolve({
      OMP_PROFILE: "",
      PI_PROFILE: "work",
      PI_CODING_AGENT_DIR: join(home, ".omp", "profiles", "work", "agent"),
    }),
    join(home, ".omp", "agent", "sessions"),
  );
  assert.throws(() => resolve({ OMP_PROFILE: "../../elsewhere" }), /Invalid OMP profile/u);
  assert.doesNotThrow(() =>
    resolveLocations({ paths: [`omp=${home}`] }, { OMP_PROFILE: "../../elsewhere" }, home),
  );
});
