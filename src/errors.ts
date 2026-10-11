import { Schema } from "effect";

// Public errors contain fixed messages only. Native errors can include transcript
// text, SQL, paths or credentials and must never enter reports or stderr.
export class InputReadError extends Schema.TaggedError<InputReadError>()("InputReadError", {
  message: Schema.Literal("A transcript input couldn't be read. Check its path and permissions."),
}) {
  static create() {
    return new InputReadError({
      message: "A transcript input couldn't be read. Check its path and permissions.",
    });
  }
}
export class ConfigurationError extends Schema.TaggedError<ConfigurationError>()(
  "ConfigurationError",
  {
    message: Schema.String,
  },
) {}
export class DatabaseReadError extends Schema.TaggedError<DatabaseReadError>()(
  "DatabaseReadError",
  {
    message: Schema.Literal("An agent database couldn't be read with the supported schema."),
  },
) {
  static create() {
    return new DatabaseReadError({
      message: "An agent database couldn't be read with the supported schema.",
    });
  }
}
export class ReportWriteError extends Schema.TaggedError<ReportWriteError>()("ReportWriteError", {
  message: Schema.Literal(
    "Couldn't create the report. Use a new output filename in an existing writable directory.",
  ),
}) {
  static create() {
    return new ReportWriteError({
      message:
        "Couldn't create the report. Use a new output filename in an existing writable directory.",
    });
  }
}

export class LocalModelError extends Schema.TaggedError<LocalModelError>()("LocalModelError", {
  message: Schema.Literal(
    "The local GGUF model couldn't be initialized. Check the model file, GPU choice and available memory. No download was attempted.",
  ),
}) {
  static create() {
    return new LocalModelError({
      message:
        "The local GGUF model couldn't be initialized. Check the model file, GPU choice and available memory. No download was attempted.",
    });
  }
}
export class CacheAccessError extends Schema.TaggedError<CacheAccessError>()("CacheAccessError", {
  message: Schema.Literal(
    "The inference cache couldn't be accessed. Choose a private writable --cache-dir.",
  ),
}) {
  static create() {
    return new CacheAccessError({
      message: "The inference cache couldn't be accessed. Choose a private writable --cache-dir.",
    });
  }
}
export class InferenceError extends Schema.TaggedError<InferenceError>()("InferenceError", {
  reason: Schema.Literals(["context-or-generation-limit", "invalid-extraction", "runtime-failure"]),
  message: Schema.Literal(
    "A message couldn't be analyzed reliably. It wasn't cached or counted as a clean result.",
  ),
}) {
  static create(reason: typeof InferenceError.Type.reason) {
    return new InferenceError({
      reason,
      message:
        "A message couldn't be analyzed reliably. It wasn't cached or counted as a clean result.",
    });
  }
}
export class PresentationError extends Schema.TaggedError<PresentationError>()(
  "PresentationError",
  {
    message: Schema.String,
  },
) {}
