# Format evidence and compatibility

Research date: 2026-10-11. All committed fixture text is synthetic. The later
parsing audit read local transcripts in place and retained structural counts,
not raw message text, in scratch evidence.

| Format | Evidence | Implemented projection |
| --- | --- | --- |
| Claude Code | [Maleme reader](https://github.com/Yeuoly/maleme/tree/ddc8a27e84ce91fcd9fa2df54356c0689e44f87e) | user/assistant JSONL, string/text-block content, UUID/session ID, metadata/sidechain flags, reply model; explicit legacy top-level user content |
| Codex | [Official protocol](https://github.com/openai/codex/blob/60947e234156ac12bdb7fba2477d3965f166bd34/codex-rs/protocol/src/protocol.rs), local research checkout | session_meta, user_message UI events, turn_context model; response_item and old message fallback when UI user events are absent |
| Pi | [Canonical session manager](https://github.com/earendil-works/pi/blob/e6b9a6af5d45fd191f8e90b56176a0c41aab3199/packages/coding-agent/src/core/session-manager.ts), [config](https://github.com/earendil-works/pi/blob/e6b9a6af5d45fd191f8e90b56176a0c41aab3199/packages/coding-agent/src/config.ts) | v3 session tree, provider/modelId model changes, user/assistant turns, parent lineage |
| OMP | [Session docs](https://github.com/can1357/oh-my-pi/blob/ca18a903c5d7c946c26c728a66d3a9151f0c26b1/docs/session.md), [directory resolver](https://github.com/can1357/oh-my-pi/blob/ca18a903c5d7c946c26c728a66d3a9151f0c26b1/packages/utils/src/dirs.ts) | title slot, v3 tree, default-role combined model changes, attribution-aware user turns, config/profile/XDG paths |
| Grok | [Session guide](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md), [conversation schema](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-sampling-types/src/conversation.rs) | chat_history.jsonl plus summary metadata, synthetic_reason filtering, per-assistant model_id; no invented dates |
| OpenCode | [Current message schema](https://github.com/anomalyco/opencode/blob/d21b0790a6c146815f28fea604e41e922f009590/packages/schema/src/session-message.ts), [SQL schema](https://github.com/anomalyco/opencode/blob/d21b0790a6c146815f28fea604e41e922f009590/packages/core/src/session/sql.ts), [projector](https://github.com/anomalyco/opencode/blob/d21b0790a6c146815f28fea604e41e922f009590/packages/core/src/session/projector.ts), [legacy message schema](https://github.com/anomalyco/opencode/blob/d21b0790a6c146815f28fea604e41e922f009590/packages/opencode/src/session/message-v2.ts) | Detect session_message table versus message/part tables, human text, synthetic exclusion, per-response model, epoch-ms creation time |
| Cursor desktop | [Maleme empirical adapter](https://github.com/Yeuoly/maleme/tree/ddc8a27e84ce91fcd9fa2df54356c0689e44f87e) | cursorDiskKV composerData and bubbleId records, classic workspace ItemTable chatdata; real timestamps only, model unknown |

Cursor has no public canonical persistence contract found during the narrow
research. Its adapter is an empirical compatibility reader, not an official API.
Cursor CLI's separate chats format and OpenCode's pre-SQL JSON storage aren't
implemented. Unknown database schemas emit partial-coverage diagnostics.

Grok's installed wrapper was 1.0.50 pointing at binary 1.0.13 during research.
The implemented chat-history projection follows the pinned current official
source. That older binary wasn't run or inspected for transcript compatibility.
ACP updates.jsonl is Grok's authoritative restore/event log but isn't an additional
human-message source in coredamn, avoiding double counting and guessed event joins.

OMP source version was 18.9.1. Sessions count every stored human turn across tree
branches, rather than only the currently selected leaf. The padded title slot,
compaction and branch summaries aren't user messages. A partial trailing JSONL
record produces a warning; completed earlier messages remain available. Reads
aren't transactionally consistent with a client actively appending or rewriting
its files; export or copy a session for a repeatable snapshot.

## Live parsing audit

The 2026-10-11 audit found valid U+2028/U+2029 characters inside JSON strings.
Node's readline treats these as line endings and fragmented otherwise valid
records. The JSONL reader now splits only on LF, including across stream chunks.
CRLF remains supported. A malformed final fragment still produces a diagnostic.

OMP's `developer` and `system` message roles are nonhuman context. They decode
without counting as user turns. Claude launcher records with known
`launched`/`started`/`result`/`failed` types are metadata-only files, recorded as
informational notes. Unknown envelopes still produce coverage warnings. Codex
response-only fallback is also informational and retains its provenance note.

Synthetic regressions cover these cases. A real count-only run verifies current
files without invoking inference. Live counts can change while clients write;
before/after totals aren't a fixed recovery benchmark.

## Provenance

- [Maleme](https://github.com/Yeuoly/maleme) inspected at `ddc8a27e84ce91fcd9fa2df54356c0689e44f87e`; WTFPL. Used as format/product research, with independent code and dictionary.
- [Rage AI](https://github.com/wiseiodev/rageai) inspected at `8d5a0232942d118c94cbcf2eace532ab5b7db05a`; no reuse license found. No source or lexicon copied.
- [Effect 4.0.3](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.3) pinned with [Effect tsgo 0.51.1](https://github.com/Effect-TS/tsgo) and TypeScript 7.0.2. The compiler gate checks a floating Effect actually fails.
- Commander 15.0.0 owns the command tree, choices, variadic/repeated values, help and version output. Calendar validation is a semantic option parser registered with Commander.
