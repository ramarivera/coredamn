import assert from "node:assert/strict";
import test from "node:test";
import { InferenceError } from "../src/errors.ts";
import { type ExtractionDraft, reconcileExtraction } from "../src/extraction.ts";

const empty: ExtractionDraft = { complete: true, occurrences: { insults: [], profanity: [] } };

test("independent occurrence verification prevents draft-induced positive scores", async () => {
  const result = await reconcileExtraction(
    "Please fucking zorbly.",
    { insult: 0.15, profanity: 0.99 },
    {
      extract: async () => ({
        complete: true,
        occurrences: { insults: [["zorbly", 1]], profanity: [["fucking", 1]] },
      }),
      reassess: async () => ({ insult: 0.74, profanity: 0.01 }),
      verifyCandidates: async (spans, scores, force) => {
        assert.deepEqual(force, ["insult"]);
        assert.equal(scores.profanity, 0.99, "don't revise an already consistent category");
        return spans.filter((span) => span.category === "profanity");
      },
    },
  );
  assert.equal(
    result.insultScore,
    0.15,
    "retain the original real native score confirmed by independent evidence",
  );
  assert.equal(result.profanityScore, 0.99);
  assert.deepEqual(result.spans, [{ category: "profanity", start: 7, end: 14 }]);
});

test("reassesses a false positive category instead of retrying an unchanged classifier", async () => {
  let reviews = 0;
  const result = await reconcileExtraction(
    "Please be more careful.",
    { insult: 0.94, profanity: 0.03 },
    {
      extract: async () => empty,
      verifyCandidates: async (spans) => spans,
      reassess: async () => {
        reviews++;
        return { insult: 0.07, profanity: 0.02 };
      },
    },
  );
  assert.equal(reviews, 1);
  assert.equal(result.insultScore, 0.07, "retain the actual reassessed score");
  assert.deepEqual(result.spans, []);
});

test("repairs an invented insult after reassessment and preserves native scores", async () => {
  let reviews = 0;
  const result = await reconcileExtraction(
    "Sorry, did you zorple?",
    { insult: 0.15, profanity: 0.03 },
    {
      extract: async (review) => {
        if (!review)
          return { complete: true, occurrences: { insults: [["zorple", 1]], profanity: [] } };
        assert.equal(reviews, 1);
        assert.equal(review.issue, "category-disagreement");
        assert.deepEqual(review.previous.insults, [["zorple", 1]]);
        return empty;
      },
      verifyCandidates: async (spans) => spans,
      reassess: async () => {
        reviews++;
        return { insult: 0.04, profanity: 0.01 };
      },
    },
  );
  assert.equal(result.insultScore, 0.04);
  assert.deepEqual(result.spans, []);
});

test("unchanged agreement doesn't require reassessment or another extraction", async () => {
  let calls = 0;
  const result = await reconcileExtraction(
    "You are an idiot.",
    { insult: 0.97, profanity: 0.02 },
    {
      extract: async () => {
        calls++;
        return { complete: true, occurrences: { insults: [["idiot", 1]], profanity: [] } };
      },
      verifyCandidates: async (spans) => spans,
      reassess: async () => {
        assert.fail("already consistent");
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.insultScore, 0.97);
  assert.deepEqual(result.spans, [{ category: "insult", start: 11, end: 16 }]);
});

test("rejects an invented phrase only after native occurrence verification", async () => {
  let verified = 0;
  const result = await reconcileExtraction(
    "Sorry, did you zorbly?",
    { insult: 0.15, profanity: 0.03 },
    {
      extract: async (review) => {
        assert.equal(review, undefined, "verification resolves this without another draft");
        return { complete: true, occurrences: { insults: [["zorbly", 1]], profanity: [] } };
      },
      reassess: async () => ({ insult: 0.04, profanity: 0.01 }),
      verifyCandidates: async (spans) => {
        verified++;
        assert.equal(spans.length, 1);
        return [];
      },
    },
  );
  assert.equal(verified, 1);
  assert.equal(result.insultScore, 0.04);
  assert.deepEqual(result.spans, []);
});

test("native verification can recover a missing category on a source-grounded candidate", async () => {
  const result = await reconcileExtraction(
    "You asshole.",
    { insult: 0.9, profanity: 0.9 },
    {
      extract: async () => ({
        complete: true,
        occurrences: { insults: [["asshole", 1]], profanity: [] },
      }),
      reassess: async () => ({ insult: 0.95, profanity: 0.92 }),
      verifyCandidates: async (spans) => [...spans, { category: "profanity", start: 4, end: 11 }],
    },
  );
  assert.equal(
    result.insultScore,
    0.9,
    "preserve the already consistent category's original score",
  );
  assert.equal(result.profanityScore, 0.92);
  assert.deepEqual(
    result.spans.map((span) => span.category),
    ["insult", "profanity"],
  );
});

test("repairs invalid ordinals without trusting an invalid extraction as evidence", async () => {
  const result = await reconcileExtraction(
    "You are an idiot.",
    { insult: 0.97, profanity: 0.02 },
    {
      extract: async (review) => ({
        complete: true,
        occurrences: { insults: [["idiot", review ? 1 : 2]], profanity: [] },
      }),
      verifyCandidates: async (spans) => spans,
      reassess: async () => {
        assert.fail("invalid source spans aren't evidence");
      },
    },
  );
  assert.equal(result.spans.length, 1);
});

test("unresolved disagreements remain failures after bounded reconciliation", async () => {
  let extracts = 0;
  let reviews = 0;
  await assert.rejects(
    reconcileExtraction(
      "An ambiguous statement.",
      { insult: 0.8, profanity: 0.1 },
      {
        extract: async () => {
          extracts++;
          return empty;
        },
        verifyCandidates: async (spans) => spans,
        reassess: async () => {
          reviews++;
          return { insult: 0.8, profanity: 0.1 };
        },
      },
    ),
    (error: unknown) => error instanceof InferenceError && error.reason === "invalid-extraction",
  );
  assert.equal(extracts, 3);
  assert.equal(reviews, 2);
});

test("truncated generation is never accepted or reclassified as clean", async () => {
  await assert.rejects(
    reconcileExtraction(
      "A target.",
      { insult: 0.1, profanity: 0.1 },
      {
        extract: async () => ({ ...empty, complete: false }),
        verifyCandidates: async (spans) => spans,
        reassess: async () => {
          assert.fail("incomplete generation");
        },
      },
    ),
    (error: unknown) =>
      error instanceof InferenceError && error.reason === "context-or-generation-limit",
  );
});
