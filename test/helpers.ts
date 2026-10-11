import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Agent, Config } from "../src/types.ts";

export async function workspace(): Promise<string> {
  const base = join(
    process.env.COREDAMN_SCRATCH_DIR ?? join(homedir(), ".cache", "coredamn", "development"),
    "tests",
  );
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, "fixture-"));
}
export async function jsonl(path: string, records: readonly unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`);
}
export const when = "2026-10-11T09:00:00.000Z";
export const millis = Date.parse(when);
export async function fixtureAll(root: string): Promise<Config> {
  const paths: Partial<Record<Agent, string[]>> = {};
  for (const name of ["claude", "codex", "pi", "omp", "grok", "opencode", "cursor"] as const)
    paths[name] = [join(root, name)];
  await jsonl(join(root, "claude", "projects", "project", "session.jsonl"), [
    {
      type: "user",
      uuid: "c1",
      sessionId: "SECRET_SESSION_CLAUDE",
      timestamp: when,
      message: {
        role: "user",
        content: [
          { type: "text", text: "PRIVATE_SENTINEL_RAW shit please\n```ts\nconst fuck = 1\n```" },
          { type: "tool_result", content: "idiot" },
        ],
      },
    },
    { type: "assistant", message: { role: "assistant", content: [], model: "claude-first" } },
    {
      type: "user",
      uuid: "injected",
      isMeta: true,
      message: { role: "user", content: "fuck idiot" },
    },
    {
      type: "user",
      uuid: "sidechain",
      isSidechain: true,
      message: { role: "user", content: "fuck idiot" },
    },
    {
      type: "user",
      uuid: "c2",
      sessionId: "SECRET_SESSION_CLAUDE",
      timestamp: when,
      message: { role: "user", content: "moron class assignment `shit`" },
    },
    { type: "assistant", message: { role: "assistant", content: [], model: "claude-second" } },
  ]);
  await jsonl(join(root, "codex", "sessions", "session.jsonl"), [
    { type: "session_meta", payload: { id: "SECRET_SESSION_CODEX" } },
    {
      type: "event_msg",
      timestamp: when,
      payload: { type: "user_message", message: "shit fix it" },
    },
    { type: "turn_context", payload: { model: "codex-one" } },
    {
      type: "response_item",
      timestamp: when,
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "shit fix it" }],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "# AGENTS.md instructions\nfuck idiot" }],
      },
    },
    {
      type: "event_msg",
      timestamp: "2026-10-12T09:00:00.000Z",
      payload: { type: "user_message", message: "moron again" },
    },
    { type: "turn_context", payload: { model: "codex-two" } },
  ]);
  for (const name of ["pi", "omp"] as const) {
    await jsonl(join(root, name, "encoded-cwd", "session.jsonl"), [
      { type: "title", title: "ignored fuck" },
      { type: "session", version: 3, id: `SECRET_SESSION_${name}` },
      name === "pi"
        ? {
            type: "model_change",
            id: "model",
            parentId: null,
            provider: "provider",
            modelId: "first",
          }
        : {
            type: "model_change",
            id: "model",
            parentId: null,
            model: "provider/first",
            role: "default",
          },
      {
        type: "message",
        id: "u1",
        parentId: "model",
        timestamp: when,
        message: {
          role: "user",
          content: [{ type: "text", text: "damn fix this" }],
          timestamp: millis,
          attribution: "user",
        },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        message: { role: "assistant", content: [], provider: "provider", model: "first" },
      },
      { type: "custom_message", id: "custom", parentId: "a1", content: "fuck idiot" },
      {
        type: "message",
        id: "injected",
        parentId: "custom",
        message: { role: "user", content: "fuck", attribution: "agent" },
      },
      {
        type: "message",
        id: "tool",
        parentId: "injected",
        message: { role: "toolResult", content: [{ type: "text", text: "fuck" }] },
      },
    ]);
  }
  const grok = join(root, "grok", "project", "session");
  await jsonl(join(grok, "chat_history.jsonl"), [
    { type: "system", content: "fuck" },
    { type: "user", content: [{ type: "text", text: "mierda arregla esto" }], prompt_index: 1 },
    { type: "assistant", model_id: "grok-first" },
    {
      type: "user",
      synthetic_reason: "system_reminder",
      content: [{ type: "text", text: "fuck idiot" }],
    },
    { type: "tool_result", content: "fuck" },
  ]);
  await writeFile(
    join(grok, "summary.json"),
    JSON.stringify({
      info: { id: "SECRET_SESSION_GROK" },
      current_model_id: "WRONG_LAST_MODEL",
      created_at: when,
    }),
  );
  await jsonl(join(grok, "updates.jsonl"), [
    { type: "user", content: "fuck should never scan this" },
  ]);
  await mkdir(join(root, "opencode"), { recursive: true });
  const db = new DatabaseSync(join(root, "opencode", "opencode.db"));
  db.exec(
    "CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT); CREATE TABLE part(id TEXT,message_id TEXT,time_created INTEGER,data TEXT)",
  );
  db.prepare("INSERT INTO message VALUES(?,?,?,?)").run(
    "oc1",
    "SECRET_SESSION_OC",
    millis,
    JSON.stringify({ role: "user", model: { modelID: "oc-first", providerID: "provider" } }),
  );
  const insert = db.prepare("INSERT INTO part VALUES(?,?,?,?)");
  insert.run("p1", "oc1", millis, JSON.stringify({ type: "text", text: "shit please" }));
  insert.run("p2", "oc1", millis, JSON.stringify({ type: "text", text: "fuck", synthetic: true }));
  insert.run("p3", "oc1", millis, JSON.stringify({ type: "tool", text: "fuck" }));
  db.close();
  const cursorPath = join(root, "cursor", "User", "globalStorage", "state.vscdb");
  await mkdir(dirname(cursorPath), { recursive: true });
  const cursor = new DatabaseSync(cursorPath);
  cursor.exec("CREATE TABLE cursorDiskKV(key TEXT,value TEXT)");
  cursor.prepare("INSERT INTO cursorDiskKV VALUES(?,?)").run(
    "composerData:SECRET_SESSION_CURSOR",
    JSON.stringify({
      composerId: "SECRET_SESSION_CURSOR",
      modelConfig: { modelName: "WRONG_LAST_MODEL" },
      conversation: [
        { bubbleId: "cu1", type: 1, text: "idiot fix it", createdAt: millis },
        { bubbleId: "ca1", type: 2, text: "fuck" },
      ],
    }),
  );
  cursor.close();
  return { paths };
}
