import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { CacheAccessError, LocalModelError } from "./errors.ts";

const Score = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));
const Offset = Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const AnalysisResult = Schema.Struct({
  version: Schema.Literal(1),
  insultScore: Score,
  profanityScore: Score,
  spans: Schema.Array(
    Schema.Struct({
      category: Schema.Literals(["insult", "profanity"]),
      start: Offset,
      end: Offset,
    }),
  ),
});
export type AnalysisResult = typeof AnalysisResult.Type;
export function validResult(text: string, result: AnalysisResult): boolean {
  return (
    [result.insultScore, result.profanityScore].every(
      (n) => Number.isFinite(n) && n >= 0 && n <= 1,
    ) &&
    result.insultScore >= 0.5 === result.spans.some((s) => s.category === "insult") &&
    result.profanityScore >= 0.5 === result.spans.some((s) => s.category === "profanity") &&
    result.spans.length <= 128 &&
    result.spans.every(
      (span, index) =>
        span.start < span.end &&
        span.end <= text.length &&
        !result.spans
          .slice(0, index)
          .some(
            (other) =>
              span.category === other.category && span.start < other.end && span.end > other.start,
          ),
    )
  );
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export interface ModelIdentity {
  fingerprint: string;
  path: string;
}
export interface CacheEntry {
  result: Option.Option<AnalysisResult>;
  invalid: boolean;
}
export interface ModelCache {
  identity: ModelIdentity;
  get: (text: string) => Effect.Effect<CacheEntry, CacheAccessError>;
  put: (text: string, value: AnalysisResult) => Effect.Effect<void, CacheAccessError>;
}

export class CacheService extends Context.Service<CacheService>()("coredamn/CacheService", {
  make: Effect.sync(() => ({
    open: Effect.fn("CacheService.open")(function* (
      model: string,
      directory: string,
      policy: string,
    ): Effect.fn.Return<ModelCache, LocalModelError> {
      const identity = yield* Effect.tryPromise({
        try: async () => {
          const path = await realpath(model);
          const info = await stat(path, { bigint: true });
          if (!info.isFile() || info.size < 4n) throw LocalModelError.create();
          // ctime/mtime nanoseconds and size invalidate replaced or edited weights.
          // This avoids rereading 19.6 GB on every count-only planning invocation.
          return {
            path,
            fingerprint: hash(
              JSON.stringify([
                path,
                String(info.size),
                String(info.mtimeNs),
                String(info.ctimeNs),
                String(info.ino),
              ]),
            ),
          };
        },
        catch: () => LocalModelError.create(),
      });
      const location = (text: string) =>
        join(directory, `${hash(JSON.stringify([identity.fingerprint, policy, text]))}.json`);
      const get = Effect.fn("ModelCache.get")(function* (
        text: string,
      ): Effect.fn.Return<CacheEntry, CacheAccessError> {
        const data = yield* Effect.tryPromise({
          try: () =>
            readFile(location(text), "utf8").catch((error: unknown) => {
              if (Schema.is(Schema.Struct({ code: Schema.Literal("ENOENT") }))(error))
                return undefined;
              throw error;
            }),
          catch: () => CacheAccessError.create(),
        });
        if (data === undefined) return { result: Option.none(), invalid: false };
        const decoded = Schema.decodeOption(Schema.fromJsonString(AnalysisResult))(data);
        if (Option.isNone(decoded) || !validResult(text, decoded.value))
          return { result: Option.none(), invalid: true };
        return { result: decoded, invalid: false };
      });
      const put = Effect.fn("ModelCache.put")(function* (
        text: string,
        value: AnalysisResult,
      ): Effect.fn.Return<void, CacheAccessError> {
        if (!validResult(text, value)) return yield* CacheAccessError.create();
        yield* Effect.tryPromise({
          try: async () => {
            await mkdir(directory, { recursive: true, mode: 0o700 });
            const temporary = join(directory, `.write-${randomUUID()}`);
            try {
              await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
              await rename(temporary, location(text));
            } finally {
              await unlink(temporary).catch((error: unknown) => {
                if (!Schema.is(Schema.Struct({ code: Schema.Literal("ENOENT") }))(error))
                  throw error;
              });
            }
          },
          catch: () => CacheAccessError.create(),
        });
      });
      return { identity, get, put };
    }),
  })),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
