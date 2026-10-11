import type { Config, Language, Term } from "./types.ts";

export const RULESET = "coredamn-reviewed-1";
// Small independent list, deliberately omitting ambiguous short fragments.
// These labels describe dictionary matches, not sentiment or intent.
const groups: [Language, Term["category"], string[]][] = [
  [
    "en",
    "profanity",
    [
      "fuck",
      "fucking",
      "fucked",
      "fucker",
      "motherfucker",
      "shit",
      "shitty",
      "bullshit",
      "damn",
      "goddamn",
      "crap",
    ],
  ],
  ["en", "insult", ["idiot", "idiots", "moron", "morons", "asshole", "bastard", "dumbass"]],
  ["de", "profanity", ["scheiße", "scheisse", "verdammt", "scheiß", "scheiss"]],
  ["de", "insult", ["arschloch", "idiotisch", "vollidiot", "dummkopf"]],
  ["es", "profanity", ["mierda", "joder", "coño", "carajo", "puta"]],
  ["es", "insult", ["imbécil", "imbecil", "gilipollas", "pendejo", "idiota"]],
  ["zh", "profanity", ["他妈的", "操你妈"]],
  ["zh", "insult", ["傻逼", "蠢货"]],
  ["ja", "profanity", ["くそ", "クソ"]],
  ["ja", "insult", ["馬鹿", "バカ"]],
  ["ko", "profanity", ["씨발"]],
  ["ko", "insult", ["병신"]],
];
export function rules(config: Config, languages: readonly Language[]): Term[] {
  const terms = groups.flatMap(([language, category, items]) =>
    items.map((term) => ({ term, category, language })),
  );
  const ignored = new Set(
    (config.ignoreTerms ?? []).map((t) => t.normalize("NFKC").toLocaleLowerCase("en")),
  );
  const byTerm = new Map<string, Term>();
  for (const item of [...terms, ...(config.terms ?? [])]) {
    const term = item.term.normalize("NFKC").toLocaleLowerCase("en").trim();
    if (languages.includes(item.language) && !ignored.has(term))
      byTerm.set(term, { ...item, term });
  }
  return [...byTerm.values()].sort(
    (a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term),
  );
}
export function matches(text: string, terms: readonly Term[]): Term[] {
  const normalized = text.toLocaleLowerCase("en");
  const hits: Term[] = [];
  const occupied = new Set<number>();
  for (const item of terms) {
    const escaped = item.term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const cjk = ["zh", "ja", "ko"].includes(item.language);
    const pattern = new RegExp(
      cjk ? escaped : `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
      "gu",
    );
    for (const match of normalized.matchAll(pattern)) {
      const start = match.index;
      if (Array.from({ length: match[0].length }, (_, i) => start + i).some((i) => occupied.has(i)))
        continue;
      hits.push(item);
      for (let i = start; i < start + match[0].length; i++) occupied.add(i);
    }
  }
  return hits;
}
