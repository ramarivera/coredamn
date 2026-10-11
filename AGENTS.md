# Coredamn

A local-first Node/TypeScript CLI. Commander owns argument parsing, validation,
help and dispatch. Don't introduce a bespoke command parser.

Use strict TypeScript and Effect 4 services with explicit layers and typed errors.
Validate consumed native transcript fields with Effect Schema. Inputs stay
read-only; reports contain aggregates. Never commit personal transcripts, model
weights, credentials or generated reports. Tests use synthetic fixtures.

Keep source discovery, parsing, eligibility, detection, caching and presentation
separate. Count-only plans must not initialize a model or run detection. Cache
entries contain validated scores and source offsets, never full message text.
Keep incomplete coverage visible.

Run pnpm check, pnpm package and pnpm check:package for implementation verification.
Optional browser, PTY and native-model acceptance commands are in README.md.
Development artifacts default to ~/.cache/coredamn/development and can be moved
with COREDAMN_SCRATCH_DIR. scripts/build.mjs owns the local dist symlink.
Preserve unrelated files. Don't commit, push or publish unless requested.
