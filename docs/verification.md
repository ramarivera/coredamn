# Verification

The core suite uses synthetic fixtures for all seven agents, both OpenCode
SQLite layouts, both Cursor desktop stores, model changes, tree branches,
injected context, archived duplicates, malformed records, missing paths, unknown
dates, custom dictionary rules and read-only input behavior. No personal
transcripts are committed as fixtures.

`pnpm check` runs strict TypeScript, Effect compiler checks, Biome, the unit-test
suite and production compilation. The Effect gate deliberately rejects a floating
Effect and accepts the corrected fixture. Native transcript projections are
Schema-derived. There is no generic JSON-record transcript pipeline. Extraction
regressions cover category disagreements, draft-induced positives, independent
source verification, invalid ordinals, bounded retries and truncated generation.
Ordinal recovery checks nested word forms, global numbering, quoted occurrences,
missing phrases, preservation of unaffected categories and candidate capacity
without trusting model-provided offsets.

`pnpm package` builds a real npm tarball. `pnpm check:package` installs it into an
isolated directory and checks the packaged executable's help, version, dictionary
scan, count-only plan and 1200 by 630 PNG. Development scripts and dependencies
aren't in the published manifest.

`pnpm check:browser` runs headless Chromium against generated HTML. It checks
model grouping, search, weighted vocabulary, count/rate chart selection, mobile
overflow, external requests and JavaScript exceptions. It requires a `chromium`
executable. `python3 scripts/tui-proof.py` exercises keyboard controls and resize
in an isolated Unix PTY without desktop input.

`node scripts/native-proof.mjs /path/to/Qwen3.5-27B.gguf` is an opt-in real-model
acceptance run. It evaluates the 31 frozen synthetic cases, category counts and
phrases, then repeats the CLI scan to check cache reuse and zero new inference.
It requires existing weights and a working native backend. The default backend
is Vulkan; set COREDAMN_PROOF_GPU to another supported backend as needed.
This suite doesn't establish general accuracy or score calibration.

Artifacts and isolated profiles default to ~/.cache/coredamn/development.
COREDAMN_SCRATCH_DIR overrides that location. Local fixtures and package checks
don't prove universal compatibility with every native-client version, files
being rewritten concurrently, or Windows/macOS desktop stores. See
[sources.md](sources.md) for format evidence and limitations.
