import { Schema } from "effect";

// Deliberate projections of native formats. Unknown extension fields are ignored;
// every consumed field is decoded. No transcript is cast to a record/interface.
const OptionalString = Schema.optionalKey(Schema.String);
const OptionalTime = Schema.optionalKey(Schema.Union([Schema.String, Schema.Finite]));
export const TextBlock = Schema.Struct({ type: Schema.String, text: OptionalString });
export const Content = Schema.Union([Schema.String, Schema.Array(TextBlock)]);
export type Content = typeof Content.Type;
export const Envelope = Schema.Struct({ type: Schema.String });

export const ClaudeTurn = Schema.Struct({
  type: Schema.Literals(["user", "assistant"]),
  uuid: OptionalString,
  sessionId: OptionalString,
  timestamp: OptionalTime,
  isMeta: Schema.optionalKey(Schema.Boolean),
  isSidechain: Schema.optionalKey(Schema.Boolean),
  message: Schema.Struct({
    role: Schema.Literals(["user", "assistant"]),
    content: Content,
    model: OptionalString,
  }),
});
export type ClaudeTurn = typeof ClaudeTurn.Type;
export const ClaudeLegacy = Schema.Struct({
  type: Schema.Literal("user"),
  content: Content,
  uuid: OptionalString,
  sessionId: OptionalString,
  timestamp: OptionalTime,
  isMeta: Schema.optionalKey(Schema.Boolean),
  isSidechain: Schema.optionalKey(Schema.Boolean),
});

export const CodexSession = Schema.Struct({
  type: Schema.Literal("session_meta"),
  payload: Schema.Struct({ id: Schema.String }),
});
export const CodexContext = Schema.Struct({
  type: Schema.Literal("turn_context"),
  payload: Schema.Struct({ model: Schema.String }),
});
export const CodexEvent = Schema.Struct({
  type: Schema.Literal("event_msg"),
  timestamp: OptionalTime,
  payload: Schema.Struct({ type: Schema.String, message: OptionalString }),
});
export const CodexResponse = Schema.Struct({
  type: Schema.Literal("response_item"),
  timestamp: OptionalTime,
  payload: Schema.Struct({
    type: Schema.String,
    role: OptionalString,
    id: OptionalString,
    content: Schema.optionalKey(Content),
  }),
});
export const CodexLegacy = Schema.Struct({
  type: Schema.Literal("message"),
  role: Schema.String,
  content: Content,
  id: OptionalString,
  timestamp: OptionalTime,
});

export const TreeSession = Schema.Struct({ type: Schema.Literal("session"), id: Schema.String });
export const PiModel = Schema.Struct({
  type: Schema.Literal("model_change"),
  provider: Schema.String,
  modelId: Schema.String,
});
export const OmpModel = Schema.Struct({
  type: Schema.Literal("model_change"),
  model: Schema.String,
  role: OptionalString,
});
export const TreeTurn = Schema.Struct({
  type: Schema.Literal("message"),
  id: Schema.String,
  parentId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  timestamp: OptionalTime,
  message: Schema.Union([
    Schema.Struct({
      role: Schema.Literal("user"),
      content: Content,
      timestamp: OptionalTime,
      attribution: OptionalString,
    }),
    Schema.Struct({
      role: Schema.Literal("assistant"),
      provider: OptionalString,
      model: OptionalString,
      timestamp: OptionalTime,
    }),
    Schema.Struct({
      role: Schema.Literals([
        "toolResult",
        "bashExecution",
        "pythonExecution",
        "fileMention",
        "custom",
        "custom_message",
        "session_init",
        "meta",
        "tool",
        "developer",
        "system",
      ]),
    }),
  ]),
});
export type TreeTurn = typeof TreeTurn.Type;

export const GrokSummary = Schema.Struct({
  info: Schema.Struct({ id: Schema.String }),
  parent_session_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export const GrokUser = Schema.Struct({
  type: Schema.Literal("user"),
  content: Content,
  synthetic_reason: OptionalString,
  prompt_index: Schema.optionalKey(Schema.Finite),
});
export const GrokAssistant = Schema.Struct({
  type: Schema.Literal("assistant"),
  model_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export const OpenCodeMessage = Schema.Struct({
  role: Schema.String,
  model: Schema.optionalKey(Schema.Struct({ modelID: OptionalString, providerID: OptionalString })),
  modelID: OptionalString,
  providerID: OptionalString,
});
export const OpenCodePart = Schema.Struct({
  type: Schema.String,
  text: OptionalString,
  synthetic: Schema.optionalKey(Schema.Boolean),
  ignored: Schema.optionalKey(Schema.Boolean),
});
export const MessageRow = Schema.Struct({
  id: Schema.String,
  session_id: Schema.String,
  time_created: Schema.Finite,
  data: Schema.String,
});
export const PartRow = Schema.Struct({ message_id: Schema.String, data: Schema.String });
export const OpenCodeV2Row = Schema.Struct({
  id: Schema.String,
  session_id: Schema.String,
  type: Schema.String,
  data: Schema.String,
});
export const OpenCodeV2User = Schema.Struct({
  text: Schema.String,
  time: Schema.Struct({ created: Schema.Finite }),
});
export const OpenCodeV2Assistant = Schema.Struct({
  model: Schema.Struct({ id: Schema.String, providerID: Schema.String }),
});
export const KeyValueRow = Schema.Struct({
  key: Schema.String,
  value: Schema.Union([Schema.String, Schema.Uint8Array]),
});
export const CursorBubble = Schema.Struct({
  type: Schema.Union([Schema.String, Schema.Finite]),
  text: Schema.optionalKey(Content),
  bubbleId: OptionalString,
  createdAt: OptionalTime,
});
export const CursorComposer = Schema.Struct({
  composerId: Schema.String,
  modelConfig: Schema.optionalKey(Schema.Struct({ modelName: OptionalString })),
  conversation: Schema.optionalKey(Schema.Array(CursorBubble)),
  fullConversationHeadersOnly: Schema.optionalKey(
    Schema.Array(Schema.Struct({ bubbleId: Schema.String })),
  ),
});
export const CursorChats = Schema.Struct({
  tabs: Schema.Array(
    Schema.Struct({
      id: OptionalString,
      bubbles: Schema.Array(CursorBubble),
    }),
  ),
});
