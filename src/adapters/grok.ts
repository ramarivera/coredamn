import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { InputReadError } from "../errors.ts";
import { type Diagnostics, jsonLines } from "../io.ts";
import { Envelope, GrokAssistant, GrokSummary, GrokUser } from "../schemas.ts";
import { contentText, humanText } from "../text.ts";
import type { Message } from "../types.ts";
import { fingerprint } from "./jsonl.ts";

export const readGrok = Effect.fn("Grok.read")(function* (
  path: string,
  diagnostics: Diagnostics,
): Effect.fn.Return<Message[], InputReadError> {
  const summary = yield* Effect.tryPromise({
    try: () => readFile(join(dirname(path), "summary.json"), "utf8"),
    catch: () => InputReadError.create(),
  }).pipe(Effect.catchTag("InputReadError", () => Effect.succeed("null")));
  const decoded = Schema.decodeOption(Schema.fromJsonString(GrokSummary))(summary);
  const session = Option.isSome(decoded) ? decoded.value.info.id : fingerprint(dirname(path));
  if (Option.isNone(decoded)) diagnostics.add("grok", "missing-session-metadata");
  const messages: Message[] = [];
  let pending: Message[] = [];
  let index = 0;
  let recognized = 0;
  yield* Effect.tryPromise({
    try: async () => {
      for await (const raw of jsonLines(path, "grok", diagnostics)) {
        index++;
        const envelope = Schema.decodeUnknownOption(Envelope)(raw);
        if (Option.isNone(envelope)) {
          diagnostics.add("grok", "invalid-record");
          continue;
        }
        if (envelope.value.type === "user") {
          const row = Schema.decodeUnknownOption(GrokUser)(raw);
          if (Option.isNone(row)) {
            diagnostics.add("grok", "invalid-record");
            continue;
          }
          recognized++;
          if (row.value.synthetic_reason && row.value.synthetic_reason !== "human") continue;
          const text = humanText(contentText(row.value.content));
          if (!text) continue;
          const message: Message = {
            agent: "grok",
            session,
            id: fingerprint(`${row.value.prompt_index ?? index}:${text}`),
            text,
            timestamp: Option.none(),
            model: Option.none(),
            confidence: "structured",
          };
          messages.push(message);
          pending.push(message);
        } else if (envelope.value.type === "assistant") {
          const row = Schema.decodeUnknownOption(GrokAssistant)(raw);
          if (Option.isNone(row)) {
            diagnostics.add("grok", "invalid-record");
            continue;
          }
          recognized++;
          for (const message of pending) message.model = Option.fromNullishOr(row.value.model_id);
          pending = [];
        }
      }
    },
    catch: () => InputReadError.create(),
  });
  // Fork history has no stable item IDs. Report this limitation instead of
  // deleting legitimate repeated prompts on a guessed text fingerprint.
  if (Option.isSome(decoded) && decoded.value.parent_session_id)
    diagnostics.add("grok", "fork-history-may-overlap");
  if (!recognized) diagnostics.add("grok", "unsupported-format");
  return messages;
});
