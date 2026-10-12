import { type AnalysisResult, validResult } from "./cache.ts";
import { InferenceError } from "./errors.ts";
import { type Occurrences, resolveOccurrences } from "./policy.ts";

export interface CategoryScores {
  readonly insult: number;
  readonly profanity: number;
}
export interface ExtractionDraft {
  readonly occurrences: Occurrences;
  readonly complete: boolean;
}
export interface ExtractionReview {
  readonly scores: CategoryScores;
  readonly previous: Occurrences;
  readonly issue: "invalid-occurrences" | "category-disagreement";
}
export interface ExtractionDriver {
  readonly extract: (review?: ExtractionReview) => Promise<ExtractionDraft>;
  readonly reassess: (draft: Occurrences) => Promise<CategoryScores>;
  readonly verifyCandidates: (
    spans: AnalysisResult["spans"],
    scores: CategoryScores,
    force: readonly ("insult" | "profanity")[],
  ) => Promise<AnalysisResult["spans"]>;
}
function resolve(text: string, draft: ExtractionDraft): AnalysisResult["spans"] {
  if (!draft.complete) throw InferenceError.create("context-or-generation-limit");
  return [
    ...resolveOccurrences(text, draft.occurrences.insults).map((span) => ({
      category: "insult" as const,
      ...span,
    })),
    ...resolveOccurrences(text, draft.occurrences.profanity).map((span) => ({
      category: "profanity" as const,
      ...span,
    })),
  ];
}
export async function reconcileExtraction(
  text: string,
  initial: CategoryScores,
  driver: ExtractionDriver,
): Promise<AnalysisResult> {
  let draft = await driver.extract();
  let scores = initial;
  for (let round = 0; round <= 2; round++) {
    let spans: AnalysisResult["spans"] | undefined;
    try {
      spans = resolve(text, draft);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
    const result = (): AnalysisResult => ({
      version: 1,
      insultScore: scores.insult,
      profanityScore: scores.profanity,
      spans: spans ?? [],
    });
    if (spans && validResult(text, result())) return result();
    if (round === 2) break;
    if (spans) {
      const previous = scores;
      const disputed = (["insult", "profanity"] as const).filter(
        (category) => scores[category] >= 0.5 !== spans?.some((span) => span.category === category),
      );
      const reviewed = await driver.reassess(draft.occurrences);
      scores = { ...scores };
      for (const category of disputed) scores = { ...scores, [category]: reviewed[category] };
      // A newly positive score must not validate the draft that suggested it.
      const newlyPositive = disputed.filter(
        (category) => previous[category] < 0.5 && scores[category] >= 0.5,
      );
      if (!newlyPositive.length && validResult(text, result())) return result();
      spans = await driver.verifyCandidates(spans, scores, newlyPositive);
      // Independent occurrence verification breaks a tie between two real native
      // scores. Keep the score agreeing with that evidence; never manufacture one.
      for (const category of disputed) {
        const present = spans.some((span) => span.category === category);
        if (scores[category] >= 0.5 !== present && previous[category] >= 0.5 === present)
          scores = { ...scores, [category]: previous[category] };
      }
      if (validResult(text, result())) return result();
    }
    draft = await driver.extract({
      scores,
      previous: draft.occurrences,
      issue: spans ? "category-disagreement" : "invalid-occurrences",
    });
  }
  throw InferenceError.create("invalid-extraction");
}
