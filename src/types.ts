export const AGENTS = ["claude", "codex", "pi", "omp", "grok", "opencode", "cursor"] as const;
export type Agent = (typeof AGENTS)[number];

import type { Option } from "effect";
export type Category = "profanity" | "insult";
export type Language = "en" | "de" | "es" | "zh" | "ja" | "ko";
export const LANGUAGES: Language[] = ["en", "de", "es", "zh", "ja", "ko"];

export interface Message {
  agent: Agent;
  session: string;
  id: string;
  text: string;
  timestamp: Option.Option<string>;
  model: Option.Option<string>;
  confidence: "structured" | "legacy";
}
export interface Diagnostic {
  agent: Agent;
  code: string;
  count: number;
  severity: "info" | "warning";
}
export interface Term {
  term: string;
  category: Category;
  language: Language | "und";
}
export interface Config {
  agents?: Agent[];
  paths?: Partial<Record<Agent, string[]>>;
  terms?: (Term & { language: Language })[];
  ignoreTerms?: string[];
  languages?: Language[];
}
export interface Location {
  agent: Agent;
  path: string;
  source: string;
  explicit: boolean;
  exists: boolean;
  unreadable?: boolean;
}
export interface Counts {
  messages: number;
  words: number;
  hits: number;
  profanity: number;
  insults: number;
  per1000Words: number;
}
export interface Breakdown extends Counts {
  label: string;
}
export interface Report {
  schemaVersion: 1;
  ruleset: string;
  generatedAt: string;
  status: "complete" | "partial" | "empty";
  totals: Counts;
  byAgent: Breakdown[];
  byModel: Breakdown[];
  bySession: Breakdown[];
  byDay: Breakdown[];
  terms: { term: string; category: Category; language: Term["language"]; count: number }[];
  diagnostics: Diagnostic[];
  filesRead: number;
  duplicatesRemoved: number;
  unknownDates: number;
  filters: { since: string | null; until: string | null; languages: Language[] };
  analysis?: AnalysisSummary;
}

export type Detector = "dictionary" | "local";
export interface AnalysisSummary {
  detector: Detector;
  policy: string;
  eligibleMessages: number;
  cachedMessages: number;
  inferredMessages: number;
  skippedMessages: number;
  model?: string;
}
export interface ScanPlan {
  kind: "plan";
  status: Report["status"];
  detector: Detector;
  eligibleMessages: number;
  words: number;
  filesRead: number;
  duplicatesRemoved: number;
  byAgent: { agent: Agent; messages: number; words: number }[];
  cachedMessages: number;
  pendingMessages: number;
  blockedMessages: number;
  selectedMessages: number;
  repeatedInputs: number;
  estimatedSeconds: number | null;
  diagnostics: Diagnostic[];
}

export function agent(value: string): Agent {
  if (AGENTS.includes(value as Agent)) return value as Agent;
  throw new Error(`Unknown agent '${value}'. Choose ${AGENTS.join(", ")}.`);
}
export function timestamp(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (value === "") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
