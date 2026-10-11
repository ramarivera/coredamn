# coredamn

A core dump of your patience.

Count profanity and insults in the human messages you've sent to coding agents.
Compare agents, response models, sessions and days, using both raw counts and
matches per 1,000 user words. Everything runs locally. No API keys, uploads,
telemetry or network requests.

Built with Node, TypeScript, Commander and Effect 4. Native transcript formats
have Effect schemas. Untrusted JSON enters as `unknown`; adapters consume decoded
records, not generic JSON dictionaries. Effect owns service composition, typed
failures and resource lifetimes. Commander owns command dispatch and arguments.

## Run locally

Requires Node 24.15 or later and pnpm. Mise pins the development tool versions.
This repository hasn't been published to npm yet.

```nu
cd ~/dev/coredamn
pnpm install
pnpm dev --help
pnpm dev discover
pnpm dev plan
pnpm dev scan
```

`discover` lists resolved paths and checks their existence without reading chat
content. `plan` reads transcripts to count eligible messages and words without
running detection. `scan --dry-run` is the same count-only path. It still has to
read and parse the selected files, but doesn't load a model or classify messages.
None of these commands opens a browser. To select particular sources:

```nu
pnpm dev scan --agent claude --path 'claude=~/.config/claude'
pnpm dev scan --agent omp --agent grok --format json
pnpm dev scan --since 2026-10-01 --until 2026-10-11 --format html --output ./report.html
pnpm dev scan --config ./my-config.json --language en --language de
```

Agent and language options accept repeated flags or several values. Path overrides
accept `agent=/path` and can repeat for multiple installations. An explicit path
can name a source root, transcript directory or supported file. Paths containing
spaces need shell quotes. Relative config paths resolve from the config file's
directory; relative CLI paths resolve from the current working directory.

Output files use private permissions where the platform supports them and never
overwrite an existing file, including an input transcript. Without `--output`,
the selected report goes to stdout. HTML is a single offline file with searchable,
sortable breakdowns and static tables that remain readable without JavaScript.
Session IDs, input paths and full transcript text aren't included in scan reports.
Discovery output deliberately includes paths.

## Explore and share

```nu
pnpm dev tui --agent claude
pnpm dev scan --format html --output ./report.html
pnpm dev scan --format svg --output ./patience.svg
pnpm dev scan --format png --output ./patience.png
```

The terminal dashboard needs an interactive terminal. Press `g` or Tab to switch
agent, model, session and day groups, `m` to change the metric, `s` to reverse the
sort order, `/` to filter, and arrows or `j`/`k` to scroll. Press `r` to reset the
filter and `q` to quit. The dashboard also shows coverage and cache totals.

HTML includes a weighted word cloud and daily charts with count/rate selection.
Charts use UTC dates and keep undated messages separate. A missing day has no
invented data point. SVG and PNG produce a compact 1200 by 630 meme card with
counts, vocabulary, date range, coverage and detector. PNG requires `--output`.
Matched terms appear in the cloud and card, so review them before sharing.

## Cached local analysis

The dictionary is the default. For contextual detection, supply existing
Qwen3.5 GGUF weights to the opt-in native node-llama-cpp backend:

```nu
pnpm dev plan --detector local --model ~/models/Qwen3.5-27B-Q5_K_M.gguf
pnpm dev scan --detector local --model ~/models/Qwen3.5-27B-Q5_K_M.gguf --gpu vulkan --max-messages 100
```

Every eligible message goes to native decisions and constrained occurrence
extraction, including messages with no dictionary matches. This runs in the
Node process with llama.cpp. It doesn't call an OpenAI-compatible server. Weights
aren't downloaded and native bindings aren't compiled or downloaded by the scan.
The selected node-llama-cpp backend must already be available.

Decisions produce relative category scores, not calibrated probabilities. The
policy excludes quoted/reported insults, self-deprecation and criticism of code
from personal-insult counts. Profanity is a separate category. Extracted phrases
must resolve to actual source occurrences. Invalid or inconsistent results are
skipped with a diagnostic rather than counted as clean messages. Model judgments
can still be wrong.

The default limit is 100 new inference attempts per run. Cache hits don't consume
that limit. Messages over 6000 UTF-16 code units are visibly skipped, never
silently truncated. Adjust `--max-messages`, `--max-message-chars` and
`--context-size` as needed. The context defaults to 4096 tokens; insufficient
context or generation capacity produces a diagnostic. A partial report's rate
uses analyzed messages only. Its analysis section separately lists all eligible,
cached, newly inferred and skipped messages.

Rerunning resumes from validated cache entries. A fully cached run doesn't load
the native model. The cache defaults to `$XDG_CACHE_HOME/coredamn/inference-v1`,
or `~/.cache/coredamn/inference-v1`. Override it with `--cache-dir`. Entries store
scores and character offsets, not full message text. Keys hash message content,
policy/runtime/context and model identity. Model identity uses its resolved path,
size, inode and nanosecond modification/change times, avoiding a full weights
read during planning. It isn't a cryptographic digest of the model weights.

Local `plan` reports cached messages, unique pending inputs, repeated inputs,
size-blocked messages and the next bounded selection. It never writes cache
entries. Its duration estimate uses an earlier short Qwen3.5-27B synthetic trial,
not a hardware benchmark or a prediction for long transcripts. Dictionary
language/custom-term options don't apply to the local contextual policy.

## Sources and configuration

Precedence is CLI `--path`, then config `paths`, then agent environment variables,
then platform defaults. An explicitly configured missing path produces partial
coverage; it never silently falls back to a different account. If only path
entries are provided, only those agents are selected. Explicit `--agent` or
config `agents` controls the selection when present.

| Agent | Default source | Recognized configuration |
| --- | --- | --- |
| Claude Code | `~/.claude/projects` and `transcripts` | `CLAUDE_CONFIG_DIR` is the config root |
| Codex | `~/.codex/sessions` and `archived_sessions` | `CODEX_HOME` is the config root |
| Pi | `~/.pi/agent/sessions` | `PI_CODING_AGENT_SESSION_DIR`, then `PI_CODING_AGENT_DIR` plus `/sessions` |
| Oh My Pi | `~/.omp/agent/sessions` | Session-dir override, default-profile agent-dir override, `PI_CONFIG_DIR`, `OMP_PROFILE` or legacy `PI_PROFILE`, migrated XDG data directory |
| Grok CLI | `~/.grok/sessions` | `GROK_HOME` plus `/sessions` |
| OpenCode | `~/.local/share/opencode/opencode.db` | `XDG_DATA_HOME`; both legacy message/part and current session_message tables |
| Cursor desktop | Platform Cursor application-data root | `XDG_CONFIG_HOME` on Linux, `APPDATA` on Windows; global composer and workspace classic-chat databases |

OMP's resolver follows its current source, including existence-gated XDG
migration. `PI_CONFIG_DIR` is a directory name beneath the home directory.
Named profiles ignore `PI_CODING_AGENT_DIR`. An explicitly empty `OMP_PROFILE`
disables the legacy `PI_PROFILE` fallback. `PI_CODING_AGENT_SESSION_DIR` is shared
by Pi and OMP upstream; use separate `--path` overrides when scanning both.

A complete example is in [docs/config.example.json](docs/config.example.json).
There is no implicit project or home config loading.

```json
{
  "paths": { "claude": ["~/.claude"], "omp": ["~/archive/omp-sessions"] },
  "languages": ["en", "de"],
  "ignoreTerms": ["damn"],
  "terms": [{ "term": "nincompoop", "category": "insult", "language": "en" }]
}
```

## What the numbers mean

The small, reviewed dictionary covers English, German, Spanish, Chinese, Japanese
and Korean. Custom terms are literal phrases, not regular expressions. Longest
matches win on overlap. Latin-script matches use Unicode word boundaries, so
`class`, `assignment` and identifiers don't accidentally match short fragments.
The CJK list avoids neutral single characters. This is a modest dictionary, not
a complete language model or a sentiment detector.

Human prose provides both the numerator and denominator. Fenced and inline code,
URLs, tool output, known metadata and injected context wrappers are excluded.
Words use `Intl.Segmenter` word-like segments. User words aren't billed model
tokens. A dictionary match doesn't prove anger or an insult directed at an agent.
Quoted human prose still counts; arbitrary unmarked pasted logs can't always be
separated from authored text.

Claude metadata and sidechain turns are excluded. Codex's human UI events take
precedence over model-input replay records; response-only legacy data is a marked
fallback. Pi and OMP session trees count each stored user turn once across
branches. OMP attribution excludes agent-authored user-role messages when marked.
Pi's standard user role has no universal human-author marker, so unmarked injected
user messages remain a format limitation.

Models come from turn context or the corresponding response, never an account's
latest selected model. Unknown model/date values stay unknown. Grok's raw chat
history has no per-turn timestamps, so its messages appear under `unknown` dates.
Date filters exclude undated messages with a coverage note. Cursor's current
composer model setting isn't a reliable historical response model and stays
unknown here.

Stable session/message identities deduplicate archived copies. Grok forks have
no stable per-item IDs, so forked history can overlap; those sessions emit a
coverage note. We don't guess duplicates from matching text alone. Separate Cursor
classic and composer stores can also overlap without shared identities.

Counts have agent, model, pseudonymous session and UTC-day breakdowns. JSON and
HTML carry the same aggregates, coverage status and diagnostics. Model names and
matched dictionary terms are included. Review those fields before sharing a
report. Pseudonymous session labels are stable hashes, not a promise of anonymity.

| Exit code | Meaning |
| --- | --- |
| 0 | Successful discovery, or a scan with messages and no coverage warnings |
| 1 | No matching messages, or Commander argument validation failed |
| 2 | Partial coverage, invalid configuration or output/input failure |

Partial results remain available. A corrupt file or unsupported database mustn't
look like a clean zero. Diagnostic messages never include raw records or unchecked
native errors. Diagnostics distinguish warning-level coverage problems from
informational notes. Codex's response-only fallback and recognized Claude launcher
logs are informational. OMP developer/system context is recognized and excluded.
JSONL readers split on LF bytes, preserving valid Unicode paragraph separators
inside JSON strings. A broken final record still produces a warning.

## Development and verification

```nu
pnpm check
pnpm package
pnpm check:package
# Optional Unix PTY check; no desktop input
python3 scripts/tui-proof.py
# Optional native acceptance; existing local weights required
node scripts/native-proof.mjs ~/models/Qwen3.5-27B-Q5_K_M.gguf
# Optional, requires Chromium and stays headless
pnpm check:browser
```

`check` runs strict type checking with Effect's compiler diagnostics, a deliberately
failing and passing compiler fixture, Biome, synthetic integration tests and the
production build. The build uses a scratch directory under
`~/.cache/coredamn/development/`, configurable with `COREDAMN_SCRATCH_DIR`;
ignored `dist` points there. Packaging
stages real files, rather than publishing that symlink, and writes the npm tarball
under the same scratch root. `node bin/coredamn.mjs --help` runs the built CLI.

Tests use synthetic fixtures and temporary SQLite databases, never personal
transcripts. Format support is verified against these fixtures and the sources
listed in [docs/sources.md](docs/sources.md). Native installed-client compatibility,
especially Grok's older local binary and Cursor's private formats, needs checking
against exported examples before claiming universal version support.

The implementation is independent. Maleme and Rage AI inspired the product idea;
Rage AI source wasn't copied because its inspected repository had no reuse license.
MIT license applies to coredamn's code.

Release setup and the one-time manual npm bootstrap are documented in
[docs/publishing.md](docs/publishing.md). GitHub version tags publish through npm
trusted publishing after that bootstrap and trust configuration.
