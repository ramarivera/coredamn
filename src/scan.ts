import { Context, Effect, Layer } from "effect";
import type { Filters } from "./aggregate.ts";
import { type AnalysisRequest, AnalysisService } from "./analysis.ts";
import { discover, type ResolveOptions } from "./config.ts";
import type { CacheAccessError, ConfigurationError, LocalModelError } from "./errors.ts";
import type { Report, ScanPlan } from "./types.ts";

type ScanError = ConfigurationError | LocalModelError | CacheAccessError;
export class TranscriptService extends Context.Service<TranscriptService>()(
  "coredamn/TranscriptService",
  {
    make: Effect.gen(function* () {
      const analysis = yield* AnalysisService;
      return {
        discover,
        scan: Effect.fn("TranscriptService.scan")(
          (
            options: ResolveOptions,
            filters: Filters = {},
            request: AnalysisRequest = {},
          ): Effect.Effect<Report, ScanError> =>
            analysis
              .run(options, filters, { ...request, mode: "scan" })
              .pipe(Effect.map((result) => result.report)),
        ),
        plan: Effect.fn("TranscriptService.plan")(
          (
            options: ResolveOptions,
            filters: Filters = {},
            request: AnalysisRequest = {},
          ): Effect.Effect<ScanPlan, ScanError> =>
            analysis
              .run(options, filters, { ...request, mode: "plan" })
              .pipe(Effect.map((result) => result.plan)),
        ),
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(AnalysisService.layer));
}
