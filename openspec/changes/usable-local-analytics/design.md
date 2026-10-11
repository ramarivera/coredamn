# Usable local analytics

Finish condition: explain observed parsing warnings,
repair supported format mismatches with synthetic regressions, rerun a real
count-only plan, and deliver interactive terminal exploration, offline word cloud
and daily trend, PNG meme card export, and resumable cached local inference.

## Input correctness

Read transcript inputs only. Inspect structural metadata without copying raw
messages into diagnostics or fixtures. Preserve warnings for genuinely malformed
records, unsupported formats and truncated writes. Distinguish informative
fallback/metadata notes from actual incomplete coverage. Human eligibility,
deduplication and date filtering are shared between planning and execution.

## Planning and inference

Commander owns `plan`, `scan --dry-run`, `tui` and report formats. A plan parses
the selected sources and shows eligible messages, words, cached and uncached work,
coverage and an explicitly approximate duration. It never initializes the native
model, downloads weights or performs classification. Long-message handling is
explicit and never silently truncates user prose.

Dictionary detection remains the default. `--detector local --model <gguf>` opts
into node-llama-cpp decisions and constrained occurrence extraction for every
eligible message, with no dictionary gate. Qwen3.5 policy and source-position
validation come from the reviewed 27B trial. Bound runtime generation, message
size, retries and work selection; partial/unprocessed inputs remain visible.

Use a private content-addressed cache keyed by message content, model identity,
runtime and policy. Persist validated occurrence offsets and scores, not complete
messages. Reconstruct terms from the current source text. Validate cached data
before reuse and preserve completed work after interruption. Cache hits avoid
loading the model when no inference remains. Native resources are scoped and
released on errors as well as success.

## Presentation

Ink and React own terminal rendering/input. The interactive dashboard explores
agent/model/session/day groups, sort metrics, search and pagination, with clear
keyboard help and coverage. Non-interactive output remains available. All
terminal labels are sanitized before rendering.

The HTML report stays self-contained with no external scripts/fonts/requests.
Add a weighted vocabulary cloud and a UTC daily trend. Unknown dates are kept
separate. A compact 1200 by 630 SVG card feeds resvg for offline PNG export.
Show coverage, detector, counts, denominator and date range on the card. Do not
include source paths, transcript text or native session identifiers. Export
never overwrites an existing file and does not open a visible application.

## Verification

Exercise the actual CLI on synthetic fixtures, local model inference with a
small synthetic selection and a repeat proving cache hits, and a real count-only
plan. Verify TUI keyboard interaction in an isolated PTY, HTML controls and
responsive charts in headless Chromium, and inspect exported PNGs. Run the
project's check and package gates and install/run the package. No hosted
leaderboard, authentication, uploads or publication belongs to this change.
