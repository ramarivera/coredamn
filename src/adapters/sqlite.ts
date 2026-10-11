import { DatabaseSync } from "node:sqlite";
import { Effect, Option, Schema } from "effect";
import { DatabaseReadError } from "../errors.ts";
import type { Diagnostics } from "../io.ts";
import * as S from "../schemas.ts";
import { contentText, humanText } from "../text.ts";
import type { Agent, Message } from "../types.ts";
import { timestamp } from "../types.ts";
import { fingerprint } from "./jsonl.ts";

function decode<A>(
  schema: Schema.Codec<A, unknown>,
  raw: unknown,
  agent: Agent,
  diagnostics: Diagnostics,
): Option.Option<A> {
  const result = Schema.decodeUnknownOption(schema)(raw);
  if (Option.isNone(result)) diagnostics.add(agent, "invalid-database-record");
  return result;
}
function json<A>(
  schema: Schema.Codec<A, unknown>,
  raw: string,
  agent: Agent,
  diagnostics: Diagnostics,
): Option.Option<A> {
  return decode(Schema.fromJsonString(schema), raw, agent, diagnostics);
}
function openCode(db: DatabaseSync, diagnostics: Diagnostics): Message[] {
  const v2 = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_message'")
    .get();
  if (v2) return openCodeV2(db, diagnostics);
  const messages: Message[] = [];
  const rows = db
    .prepare(
      "SELECT id, session_id, time_created, data FROM message ORDER BY session_id, time_created, id",
    )
    .all();
  const parts = db.prepare(
    "SELECT message_id, data FROM part WHERE message_id = ? ORDER BY time_created, id",
  );
  const pending = new Map<string, Message[]>();
  for (const raw of rows) {
    const row = decode(S.MessageRow, raw, "opencode", diagnostics);
    if (Option.isNone(row)) continue;
    const info = json(S.OpenCodeMessage, row.value.data, "opencode", diagnostics);
    if (Option.isNone(info)) continue;
    const record = info.value;
    const modelId = record.model?.modelID ?? record.modelID;
    const provider = record.model?.providerID ?? record.providerID;
    const model = Option.fromNullishOr(
      modelId ? `${provider ? `${provider}/` : ""}${modelId}` : undefined,
    );
    if (record.role === "assistant") {
      for (const message of pending.get(row.value.session_id) ?? []) message.model = model;
      pending.set(row.value.session_id, []);
      continue;
    }
    if (record.role !== "user") continue;
    const text: string[] = [];
    for (const rawPart of parts.all(row.value.id)) {
      const partRow = decode(S.PartRow, rawPart, "opencode", diagnostics);
      if (Option.isNone(partRow)) continue;
      const part = json(S.OpenCodePart, partRow.value.data, "opencode", diagnostics);
      if (
        Option.isSome(part) &&
        part.value.type === "text" &&
        !part.value.synthetic &&
        !part.value.ignored &&
        part.value.text
      )
        text.push(part.value.text);
    }
    const clean = humanText(text.join("\n"));
    if (!clean) continue;
    const message: Message = {
      agent: "opencode",
      session: row.value.session_id,
      id: row.value.id,
      text: clean,
      timestamp: Option.fromNullishOr(timestamp(row.value.time_created)),
      model,
      confidence: "structured",
    };
    messages.push(message);
    const queue = pending.get(message.session) ?? [];
    queue.push(message);
    pending.set(message.session, queue);
  }
  return messages;
}

function openCodeV2(db: DatabaseSync, diagnostics: Diagnostics): Message[] {
  const messages: Message[] = [];
  const pending = new Map<string, Message[]>();
  for (const raw of db
    .prepare("SELECT id,session_id,type,data FROM session_message ORDER BY session_id,seq")
    .all()) {
    const row = decode(S.OpenCodeV2Row, raw, "opencode", diagnostics);
    if (Option.isNone(row)) continue;
    const item = row.value;
    if (item.type === "assistant") {
      const info = json(S.OpenCodeV2Assistant, item.data, "opencode", diagnostics);
      if (Option.isSome(info))
        for (const message of pending.get(item.session_id) ?? []) {
          message.model = Option.some(`${info.value.model.providerID}/${info.value.model.id}`);
        }
      pending.set(item.session_id, []);
    } else if (item.type === "user") {
      const info = json(S.OpenCodeV2User, item.data, "opencode", diagnostics);
      if (Option.isNone(info)) continue;
      const text = humanText(info.value.text);
      if (!text) continue;
      const message: Message = {
        agent: "opencode",
        session: item.session_id,
        id: item.id,
        text,
        timestamp: Option.fromNullishOr(timestamp(info.value.time.created)),
        model: Option.none(),
        confidence: "structured",
      };
      messages.push(message);
      const queue = pending.get(item.session_id) ?? [];
      queue.push(message);
      pending.set(item.session_id, queue);
    }
  }
  return messages;
}

function cursor(db: DatabaseSync, diagnostics: Diagnostics): Message[] {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const Name = Schema.Struct({ name: Schema.String });
  const names = tables.flatMap((row) => {
    const decoded = Schema.decodeUnknownOption(Name)(row);
    return Option.isSome(decoded) ? [decoded.value.name] : [];
  });
  const messages: Message[] = [];
  let recognized = false;
  const add = (
    session: string,
    bubble: typeof S.CursorBubble.Type,
    index: number,
    model: Option.Option<string>,
  ) => {
    if (bubble.type !== 1 && bubble.type !== "user") return;
    const text = humanText(contentText(bubble.text));
    if (!text) return;
    messages.push({
      agent: "cursor",
      session,
      id: bubble.bubbleId ?? fingerprint(`${index}:${text}`),
      text,
      timestamp: Option.fromNullishOr(timestamp(bubble.createdAt)),
      model,
      confidence: "legacy",
    });
  };
  if (names.includes("cursorDiskKV")) {
    recognized = true;
    const bubbles = db.prepare("SELECT key,value FROM cursorDiskKV WHERE key = ?");
    for (const raw of db
      .prepare("SELECT key,value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
      .all()) {
      const row = decode(S.KeyValueRow, raw, "cursor", diagnostics);
      if (Option.isNone(row)) continue;
      const value =
        typeof row.value.value === "string"
          ? row.value.value
          : Buffer.from(row.value.value).toString("utf8");
      const composer = json(S.CursorComposer, value, "cursor", diagnostics);
      if (Option.isNone(composer)) continue;
      const record = composer.value;
      // Current composer configuration isn't a reliable historic response model.
      const model = Option.none<string>();
      if (record.conversation?.length)
        record.conversation.forEach((b, i) => {
          add(record.composerId, b, i, model);
        });
      else
        for (const [i, header] of (record.fullConversationHeadersOnly ?? []).entries()) {
          const rawBubble = bubbles.get(`bubbleId:${record.composerId}:${header.bubbleId}`);
          if (!rawBubble) {
            diagnostics.add("cursor", "missing-bubble");
            continue;
          }
          const bubbleRow = decode(S.KeyValueRow, rawBubble, "cursor", diagnostics);
          if (Option.isNone(bubbleRow)) continue;
          const value =
            typeof bubbleRow.value.value === "string"
              ? bubbleRow.value.value
              : Buffer.from(bubbleRow.value.value).toString("utf8");
          const bubble = json(S.CursorBubble, value, "cursor", diagnostics);
          if (Option.isSome(bubble))
            add(record.composerId, { ...bubble.value, bubbleId: header.bubbleId }, i, model);
        }
    }
  }
  if (names.includes("ItemTable")) {
    recognized = true;
    const raw = db
      .prepare("SELECT key,value FROM ItemTable WHERE key = ?")
      .get("workbench.panel.aichat.view.aichat.chatdata");
    if (raw) {
      const row = decode(S.KeyValueRow, raw, "cursor", diagnostics);
      if (Option.isSome(row)) {
        const value =
          typeof row.value.value === "string"
            ? row.value.value
            : Buffer.from(row.value.value).toString("utf8");
        const chats = json(S.CursorChats, value, "cursor", diagnostics);
        if (Option.isSome(chats))
          for (const [tabIndex, tab] of chats.value.tabs.entries()) {
            const session = tab.id ?? fingerprint(`${tabIndex}:${JSON.stringify(tab.bubbles)}`);
            tab.bubbles.forEach((bubble, i) => {
              add(session, bubble, i, Option.none());
            });
          }
      }
    }
  }
  if (!recognized) diagnostics.add("cursor", "unsupported-database-schema");
  return messages;
}

export const readDatabase = Effect.fn("TranscriptDatabase.read")(function* (
  path: string,
  agent: "opencode" | "cursor",
  diagnostics: Diagnostics,
): Effect.fn.Return<Message[], DatabaseReadError> {
  return yield* Effect.acquireUseRelease(
    Effect.try({
      try: () => new DatabaseSync(path, { readOnly: true }),
      catch: () => DatabaseReadError.create(),
    }),
    (db) =>
      Effect.try({
        try: () => (agent === "opencode" ? openCode(db, diagnostics) : cursor(db, diagnostics)),
        catch: () => DatabaseReadError.create(),
      }),
    (db) => Effect.sync(() => db.close()),
  );
});
