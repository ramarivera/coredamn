import { Context, Effect, Layer } from "effect";
import { PresentationError } from "./errors.ts";
import type { Report, ScanPlan } from "./types.ts";
import { shareCard } from "./visuals.ts";

export function terminalPlan(plan: ScanPlan): string {
  return [
    "coredamn · count-only plan",
    "",
    `${plan.eligibleMessages} eligible human messages · ${plan.words} user words`,
    `${plan.filesRead} files · ${plan.duplicatesRemoved} duplicates removed · ${plan.status} coverage`,
    ...plan.byAgent.map((r) => `${r.agent.padEnd(12)} ${String(r.messages).padStart(8)} messages`),
    "",
    plan.detector === "local"
      ? `${plan.cachedMessages} cached messages · ${plan.pendingMessages} unique pending inputs · ${plan.repeatedInputs} repeated inputs · ${plan.blockedMessages} blocked messages`
      : "Dictionary mode. No model inference is needed.",
    ...(plan.estimatedSeconds === null
      ? []
      : [
          `Selected for the next scan: up to ${plan.selectedMessages} new inputs.`,
          `Approximate inference time: ${(plan.estimatedSeconds / 3600).toFixed(2)} hours at 8.513 seconds per short message.`,
          "This extrapolates the 27B synthetic benchmark. Real length, hardware and context limits affect time.",
        ]),
    ...plan.diagnostics.map((d) => `${d.severity}: ${d.agent} / ${d.code} (${d.count})`),
    "No detection, model initialization, downloads or cache writes were performed.",
    "",
  ].join("\n");
}

export class PresentationService extends Context.Service<PresentationService>()(
  "coredamn/PresentationService",
  {
    make: Effect.sync(() => ({
      png: Effect.fn("PresentationService.png")(
        (report: Report): Effect.Effect<Uint8Array, PresentationError> =>
          Effect.tryPromise({
            try: async () => {
              const { Resvg } = await import("@resvg/resvg-js");
              return new Resvg(shareCard(report), {
                font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" },
              })
                .render()
                .asPng();
            },
            catch: () =>
              new PresentationError({
                message:
                  "Couldn't render the offline PNG card. Check that the resvg native package supports this platform.",
              }),
          }),
      ),
      browse: Effect.fn("PresentationService.browse")(
        (report: Report): Effect.Effect<void, PresentationError> => {
          if (!process.stdin.isTTY || !process.stdout.isTTY)
            return Effect.fail(
              new PresentationError({
                message:
                  "The TUI needs an interactive terminal. Use scan --format terminal, html or json when piping output.",
              }),
            );
          return Effect.tryPromise({
            try: async () => {
              const { browse } = await import("./tui.ts");
              await browse(report);
            },
            catch: () =>
              new PresentationError({
                message:
                  "The terminal dashboard couldn't start. Use scan --format terminal or html.",
              }),
          });
        },
      ),
    })),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
