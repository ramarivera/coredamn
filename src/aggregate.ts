import { Option } from "effect";
import { fingerprint } from "./adapters/jsonl.ts";
import type { Diagnostics } from "./io.ts";
import { matches, RULESET, rules } from "./lexicon.ts";
import { prose, wordCount } from "./text.ts";
import type { Breakdown, Config, Counts, Language, Message, Report, Term } from "./types.ts";
import { LANGUAGES } from "./types.ts";

export interface Filters {
  since?: string;
  until?: string;
  languages?: Language[];
}
export interface PreparedMessage {
  message: Message;
  date: string | null;
  text: string;
  words: number;
}
const empty = (): Counts => ({
  messages: 0,
  words: 0,
  hits: 0,
  profanity: 0,
  insults: 0,
  per1000Words: 0,
});
function accumulate(counts: Counts, words: number, hits: readonly Term[]): void {
  counts.messages++;
  counts.words += words;
  counts.hits += hits.length;
  counts.profanity += hits.filter((h) => h.category === "profanity").length;
  counts.insults += hits.filter((h) => h.category === "insult").length;
  counts.per1000Words = counts.words ? Math.round((counts.hits / counts.words) * 1e6) / 1000 : 0;
}
export class Aggregator {
  private seen = new Set<string>();
  private terms: Term[];
  private totals = empty();
  private agents = new Map<string, Counts>();
  private models = new Map<string, Counts>();
  private sessions = new Map<string, Counts>();
  private days = new Map<string, Counts>();
  private termCounts = new Map<string, { term: Term; count: number }>();
  private duplicates = 0;
  private unknownDates = 0;
  private filters: Filters;
  private languages: Language[];
  private diagnostics: Diagnostics;
  constructor(config: Config, filters: Filters, diagnostics: Diagnostics) {
    this.filters = filters;
    this.diagnostics = diagnostics;
    this.languages = filters.languages ?? config.languages ?? [...LANGUAGES];
    this.terms = rules(config, this.languages);
  }
  add(message: Message): void {
    const prepared = this.prepare(message);
    if (prepared) this.record(prepared, matches(prepared.text, this.terms));
  }
  prepare(message: Message): PreparedMessage | undefined {
    const key = fingerprint(`${message.agent}\0${message.session}\0${message.id}`);
    if (this.seen.has(key)) {
      this.duplicates++;
      return;
    }
    this.seen.add(key);
    const date = Option.getOrNull(message.timestamp)?.slice(0, 10) ?? null;
    if (!date) {
      this.unknownDates++;
      if (this.filters.since || this.filters.until) {
        this.diagnostics.add(message.agent, "undated-excluded");
        return;
      }
    }
    if (
      date &&
      ((this.filters.since && date < this.filters.since) ||
        (this.filters.until && date > this.filters.until))
    )
      return;
    const text = prose(message.text);
    const words = wordCount(text);
    if (!words) return;
    return { message, date, text, words };
  }
  dictionary(text: string): Term[] {
    return matches(text, this.terms);
  }
  record({ message, date, words }: PreparedMessage, hits: readonly Term[]): void {
    accumulate(this.totals, words, hits);
    const groups: [Map<string, Counts>, string][] = [
      [this.agents, message.agent],
      [this.models, `${message.agent} / ${Option.getOrElse(message.model, () => "unknown")}`],
      [this.sessions, `${message.agent} / session-${fingerprint(message.session).slice(0, 12)}`],
      [this.days, date ?? "unknown"],
    ];
    for (const [map, label] of groups) {
      const count = map.get(label) ?? empty();
      accumulate(count, words, hits);
      map.set(label, count);
    }
    for (const term of hits) {
      const count = this.termCounts.get(term.term) ?? { term, count: 0 };
      count.count++;
      this.termCounts.set(term.term, count);
    }
  }
  finish(filesRead: number): Report {
    const sorted = (map: Map<string, Counts>): Breakdown[] =>
      [...map]
        .map(([label, counts]) => ({ label, ...counts }))
        .sort((a, b) => b.hits - a.hits || a.label.localeCompare(b.label));
    const diagnostics = this.diagnostics.list();
    return {
      schemaVersion: 1,
      ruleset: RULESET,
      generatedAt: new Date().toISOString(),
      status: diagnostics.some((d) => d.severity === "warning")
        ? "partial"
        : this.totals.messages
          ? "complete"
          : "empty",
      totals: this.totals,
      byAgent: sorted(this.agents),
      byModel: sorted(this.models),
      bySession: sorted(this.sessions),
      byDay: sorted(this.days).sort((a, b) => a.label.localeCompare(b.label)),
      terms: [...this.termCounts.values()]
        .map(({ term, count }) => ({ ...term, count }))
        .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term)),
      diagnostics,
      filesRead,
      duplicatesRemoved: this.duplicates,
      unknownDates: this.unknownDates,
      filters: {
        since: this.filters.since ?? null,
        until: this.filters.until ?? null,
        languages: this.languages,
      },
    };
  }
}
