# Design

Keep filesystem discovery, format-specific parsing, text filtering, lexicon matching, aggregation, and report rendering separate. Adapters emit a common message with agent, session, stable message identity, time, model, and text. Transient raw text exists only while scanning; outputs contain aggregates.

Use strict TypeScript, Commander 15 and Effect 4, with built-in Node filesystem, SQLite, test, and crypto APIs. Effect Schema decoders validate native transcript projections and preserve discriminated typed records through adapters. Effect services own reads, aggregation and report actions, with typed tagged errors and SQLite resource cleanup. Commander owns dispatch, variadic/repeated values, choices and help. SQLite connections must be read-only and scoped to existing input databases. This is a standalone local CLI without a hosted service, authentication, telemetry backend or product scaffold.

Metrics use Unicode-segmented user words, not provider-billed tokens. Use a small reviewed multilingual lexicon with categories and stable ruleset version. Exclude fenced/inline code from language scoring and word denominators consistently. Allow users to remove terms or add explicit custom rules. Do not present profanity counts as detected hostility.

Default outputs omit raw transcript content, paths, and session IDs. Report session comparisons with anonymous stable labels. Local JSON and HTML carry the same aggregates and visible diagnostics. Browser opening, if supported, is a separate explicit action and subject to host focus policy.

Reference sources are maleme ddc8a27e84ce91fcd9fa2df54356c0689e44f87e and Rage AI 8d5a0232942d118c94cbcf2eace532ab5b7db05a. Maleme is WTFPL. Rage source is not copied because no reuse grant was found. Record exact agent-format sources in docs/sources.md as adapters are implemented.
