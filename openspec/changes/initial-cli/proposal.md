# Coredamn local transcript analytics

Build a local Node/TypeScript CLI that measures profanity and insult lexicon hits in human-authored coding-agent messages. Support Claude Code, Codex, Pi, Oh My Pi, Grok CLI, OpenCode, and Cursor through separate format adapters.

Resolve paths from explicit flags, then supported agent environment variables, then platform defaults. Explain discovered locations without reading transcript contents. Scan only when invoked. Never modify input files or databases, make network requests, upload transcripts, or open a browser implicitly.

Produce terminal, JSON, and a self-contained HTML report with agent/model/session/date breakdowns, daily trends, word frequencies, raw counts, and hits per 1,000 user words. State that dictionary matches measure language usage rather than inferred intent or model quality. Keep reports free of raw message text and input paths by default.

Handle model changes, duplicated records, injected prompts, tool output, malformed or truncated lines, missing dates, and unknown formats explicitly. Warn about partial scans instead of claiming a clean zero.

The finish condition is a runnable packaged CLI, focused adapter and accounting fixtures, end-to-end scans covering all seven agents, strict type/lint checks, and an offline report verified without opening a visible browser. Remote repository creation, registry publication, hosted sharing, and live-user transcript scans are outside this implementation turn.
