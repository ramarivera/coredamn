import { createHash } from "node:crypto";
import { basename } from "node:path";
import { Option, Schema } from "effect";
import type { Diagnostics } from "../io.ts";
import * as S from "../schemas.ts";
import { contentText, humanText } from "../text.ts";
import type { Agent, Message } from "../types.ts";
import { timestamp } from "../types.ts";

export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
const Node = Schema.Struct({
  id: Schema.String,
  parentId: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export class JsonlParser {
  readonly messages: Message[] = [];
  private session: string;
  private model: Option.Option<string> = Option.none();
  private pending: Message[] = [];
  private fallback: Message[] = [];
  private nodes = new Map<string, Option.Option<string>>();
  private parents = new Map<string, string | null>();
  private index = 0;
  private events = 0;
  private lifecycleRecords = 0;
  recognized = 0;
  readonly agent: Agent;
  readonly diagnostics: Diagnostics;
  constructor(agent: Agent, path: string, diagnostics: Diagnostics) {
    this.agent = agent;
    this.diagnostics = diagnostics;
    this.session = fingerprint(basename(path));
  }
  private decode<A>(schema: Schema.Codec<A, unknown>, value: unknown): Option.Option<A> {
    const result = Schema.decodeUnknownOption(schema)(value);
    if (Option.isNone(result)) this.diagnostics.add(this.agent, "invalid-record");
    else this.recognized++;
    return result;
  }
  private add(text: string, time: unknown, id?: string, legacy = false): Message | undefined {
    const clean = humanText(text, this.agent === "codex");
    if (!clean) return;
    const date = timestamp(time);
    const message: Message = {
      agent: this.agent,
      session: this.session,
      id: id ?? fingerprint(`${date ?? this.index}:${clean}`),
      text: clean,
      timestamp: Option.fromNullishOr(date),
      model: this.agent === "claude" ? Option.none() : this.model,
      confidence: legacy ? "legacy" : "structured",
    };
    this.messages.push(message);
    this.pending.push(message);
    return message;
  }
  private reply(model: string | undefined | null): void {
    if (model) {
      this.model = Option.some(model);
      for (const message of this.pending) message.model = this.model;
    }
    this.pending = [];
  }
  consume(value: unknown): void {
    this.index++;
    const envelope = Schema.decodeUnknownOption(S.Envelope)(value);
    if (Option.isNone(envelope)) {
      this.diagnostics.add(this.agent, "invalid-record");
      return;
    }
    const kind = envelope.value.type;
    switch (this.agent) {
      case "claude":
        this.claude(kind, value);
        break;
      case "codex":
        this.codex(kind, value);
        break;
      case "pi":
      case "omp":
        this.tree(kind, value);
        break;
      default:
        break;
    }
  }
  private claude(kind: string, value: unknown): void {
    // Claude launcher lifecycle logs coexist with chat files. Their known
    // envelopes are metadata, not unsupported conversations or human turns.
    if (["launched", "started", "result", "failed"].includes(kind)) {
      this.recognized++;
      this.lifecycleRecords++;
      return;
    }
    if (kind !== "user" && kind !== "assistant") return;
    const turn = Schema.decodeUnknownOption(S.ClaudeTurn)(value);
    if (Option.isSome(turn)) {
      this.recognized++;
      const row = turn.value;
      if (row.isSidechain || row.isMeta) return;
      if (row.sessionId) this.session = row.sessionId;
      if (row.message.role !== row.type) {
        this.diagnostics.add(this.agent, "invalid-record");
        return;
      }
      if (row.type === "assistant") this.reply(row.message.model);
      else this.add(contentText(row.message.content), row.timestamp, row.uuid);
      return;
    }
    // The only legacy Claude projection supported is an explicit top-level user
    // content record. A malformed nested message can't fall back into this path.
    if (Schema.is(Schema.Struct({ message: Schema.Unknown }))(value)) {
      this.diagnostics.add(this.agent, "invalid-record");
      return;
    }
    const legacy = this.decode(S.ClaudeLegacy, value);
    if (Option.isSome(legacy)) {
      const row = legacy.value;
      if (row.isMeta || row.isSidechain) return;
      if (row.sessionId) this.session = row.sessionId;
      this.add(contentText(row.content), row.timestamp, row.uuid, true);
      this.diagnostics.add(this.agent, "legacy-format");
    }
  }
  private codex(kind: string, value: unknown): void {
    if (kind === "session_meta") {
      const row = this.decode(S.CodexSession, value);
      if (Option.isSome(row)) this.session = row.value.payload.id;
    } else if (kind === "turn_context") {
      const row = this.decode(S.CodexContext, value);
      if (Option.isSome(row)) {
        this.model = Option.some(row.value.payload.model);
        // In current rollouts user_message precedes the turn_context.
        if (this.pending.length) {
          for (const message of this.pending) message.model = this.model;
          this.pending = [];
          this.model = Option.none();
        }
      }
    } else if (kind === "event_msg") {
      const row = this.decode(S.CodexEvent, value);
      if (Option.isSome(row) && row.value.payload.type === "user_message") {
        this.events++;
        if (row.value.payload.message === undefined)
          this.diagnostics.add(this.agent, "invalid-record");
        else {
          const precedingContext = Option.isSome(this.model);
          this.add(row.value.payload.message, row.value.timestamp);
          if (precedingContext) this.pending = [];
          this.model = Option.none();
        }
      }
    } else if (kind === "response_item") {
      const row = this.decode(S.CodexResponse, value);
      if (
        Option.isSome(row) &&
        row.value.payload.type === "message" &&
        row.value.payload.role === "user"
      ) {
        if (this.events) return;
        if (row.value.payload.content === undefined) {
          this.diagnostics.add(this.agent, "invalid-record");
          return;
        }
        const count = this.messages.length;
        const message = this.add(
          contentText(row.value.payload.content),
          row.value.timestamp,
          row.value.payload.id,
          true,
        );
        if (message) {
          this.messages.splice(count, 1);
          this.fallback.push(message);
        }
      }
    } else if (kind === "message") {
      const row = this.decode(S.CodexLegacy, value);
      if (Option.isSome(row) && row.value.role === "user") {
        const count = this.messages.length;
        const message = this.add(
          contentText(row.value.content),
          row.value.timestamp,
          row.value.id,
          true,
        );
        if (message) {
          this.messages.splice(count, 1);
          this.fallback.push(message);
        }
      }
    }
  }
  private tree(kind: string, value: unknown): void {
    const node = Schema.decodeUnknownOption(Node)(value);
    if (Option.isSome(node)) {
      if (node.value.parentId !== undefined)
        this.model = node.value.parentId
          ? (this.nodes.get(node.value.parentId) ?? Option.none())
          : Option.none();
      this.parents.set(node.value.id, node.value.parentId ?? null);
    }
    if (kind === "session") {
      const row = this.decode(S.TreeSession, value);
      if (Option.isSome(row)) this.session = row.value.id;
    } else if (kind === "model_change") {
      if (this.agent === "omp") {
        const row = this.decode(S.OmpModel, value);
        if (Option.isSome(row) && (!row.value.role || row.value.role === "default"))
          this.model = Option.some(row.value.model);
      } else {
        const row = this.decode(S.PiModel, value);
        if (Option.isSome(row))
          this.model = Option.some(`${row.value.provider}/${row.value.modelId}`);
      }
    } else if (kind === "message") {
      const row = this.decode(S.TreeTurn, value);
      if (Option.isSome(row)) {
        const item = row.value;
        const message = item.message;
        if (message.role === "user" && (!message.attribution || message.attribution === "user")) {
          this.add(contentText(message.content), item.timestamp ?? message.timestamp, item.id);
        } else if (message.role === "assistant") {
          if (message.model) {
            this.model = Option.some(
              `${message.provider ? `${message.provider}/` : ""}${message.model}`,
            );
            const ancestors = new Set<string>();
            let parent = item.parentId;
            while (parent && !ancestors.has(parent)) {
              ancestors.add(parent);
              parent = this.parents.get(parent);
            }
            for (const pending of this.pending)
              if (ancestors.has(pending.id)) pending.model = this.model;
            this.pending = this.pending.filter((pending) => !ancestors.has(pending.id));
          }
        }
      }
    }
    if (Option.isSome(node)) this.nodes.set(node.value.id, this.model);
  }
  finish(): Message[] {
    if (this.agent === "codex" && !this.events && this.fallback.length) {
      this.messages.push(...this.fallback);
      this.diagnostics.add(this.agent, "legacy-format");
    }
    if (!this.recognized) this.diagnostics.add(this.agent, "unsupported-format");
    else if (
      this.agent === "claude" &&
      this.lifecycleRecords === this.recognized &&
      !this.messages.length
    )
      this.diagnostics.add(this.agent, "metadata-only-file");
    return this.messages;
  }
}
