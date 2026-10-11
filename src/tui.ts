import { Box, render, Text, useApp, useInput, useWindowSize } from "ink";
import type { ReactElement } from "react";
import { createElement as h, useState } from "react";
import { safeTerminal } from "./report.ts";
import type { Breakdown, Report } from "./types.ts";

const groups = ["byAgent", "byModel", "bySession", "byDay"] as const;
const names = ["Agent", "Model", "Session", "UTC day"];
const metrics = ["hits", "per1000Words", "words"] as const;
const labels = ["Occurrences", "Per 1,000 words", "User words"];
const pageSize = 8;
function Dashboard({ report }: { report: Report }): ReactElement {
  const { exit } = useApp();
  const { columns: width } = useWindowSize();
  const [groupIndex, setGroup] = useState(0);
  const [metricIndex, setMetric] = useState(0);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [offset, setOffset] = useState(0);
  const [ascending, setAscending] = useState(false);
  const group = groups[groupIndex] ?? "byAgent";
  const metric = metrics[metricIndex] ?? "hits";
  const rows = report[group]
    .filter((r) => safeTerminal(r.label).toLowerCase().includes(query.toLowerCase()))
    .sort(
      (a, b) => (ascending ? 1 : -1) * (a[metric] - b[metric]) || a.label.localeCompare(b.label),
    );
  const start = Math.min(offset, Math.max(0, rows.length - 1));
  useInput((input, key) => {
    if (editing) {
      if (key.escape || key.return) {
        setEditing(false);
        return;
      }
      if (key.backspace || key.delete) {
        setQuery((q) => [...q].slice(0, -1).join(""));
        setOffset(0);
        return;
      }
      if (!key.ctrl && !key.meta && !key.upArrow && !key.downArrow) {
        setQuery((q) => (q + input.replace(/[\p{Cc}\p{Cf}]/gu, "")).slice(0, 100));
        setOffset(0);
      }
      return;
    }
    if (input === "q" || key.escape) {
      exit();
      return;
    }
    if (input === "/") {
      setEditing(true);
      return;
    }
    if (input === "g" || key.tab) {
      setGroup((i) => (i + 1) % groups.length);
      setOffset(0);
    }
    if (input === "m") {
      setMetric((i) => (i + 1) % metrics.length);
      setOffset(0);
    }
    if (input === "s") {
      setAscending((a) => !a);
      setOffset(0);
    }
    if (input === "r") {
      setQuery("");
      setOffset(0);
    }
    if (key.downArrow || input === "j")
      setOffset(Math.min(Math.max(0, rows.length - 1), start + 1));
    if (key.upArrow || input === "k") setOffset(Math.max(0, start - 1));
    if (key.pageDown) setOffset(Math.min(Math.max(0, rows.length - 1), start + pageSize));
    if (key.pageUp) setOffset(Math.max(0, start - pageSize));
  });
  const narrow = width < 80;
  const labelWidth = Math.max(12, Math.min(55, width - (narrow ? 20 : 48)));
  const row = (r: Breakdown): ReactElement =>
    h(
      Box,
      { key: r.label, flexDirection: "row" },
      h(Box, { width: labelWidth }, h(Text, { wrap: "truncate-end" }, safeTerminal(r.label))),
      ...(narrow
        ? [
            h(
              Box,
              { width: 16, justifyContent: "flex-end" },
              h(Text, null, r[metric].toLocaleString("en")),
            ),
          ]
        : [
            h(
              Box,
              { width: 10, justifyContent: "flex-end" },
              h(Text, null, r.hits.toLocaleString("en")),
            ),
            h(
              Box,
              { width: 14, justifyContent: "flex-end" },
              h(Text, null, r.words.toLocaleString("en")),
            ),
            h(
              Box,
              { width: 14, justifyContent: "flex-end" },
              h(Text, null, r.per1000Words.toLocaleString("en")),
            ),
          ]),
    );
  const dated = report.byDay.filter((r) => r.label !== "unknown").slice(-30);
  const peak = Math.max(1, ...dated.map((r) => r.hits));
  const shades = [..."▁▂▃▄▅▆▇█"];
  const spark = dated
    .map((r) => shades[Math.min(7, Math.floor((r.hits / peak) * 7))] ?? "▁")
    .join("");
  return h(
    Box,
    {
      flexDirection: "column",
      padding: 1,
      borderStyle: "round",
      borderColor: "green",
      width: Math.max(30, width - 1),
    },
    h(Text, { color: "green", bold: true }, "coredamn / a core dump of your patience"),
    h(
      Text,
      null,
      `${report.totals.hits} occurrences · ${report.totals.profanity} profanity · ${report.totals.insults} insults`,
    ),
    h(
      Text,
      { dimColor: true },
      `${report.totals.messages} human messages · ${report.totals.words.toLocaleString("en")} words · ${report.status} coverage`,
    ),
    h(Text, null, " "),
    h(
      Text,
      { bold: true },
      `${names[groupIndex]} / ${labels[metricIndex]} / ${ascending ? "ascending" : "descending"}`,
    ),
    h(
      Text,
      { color: editing ? "yellow" : "white" },
      `Filter: ${query || "all groups"}${editing ? "▌" : ""}`,
    ),
    h(
      Text,
      { dimColor: true },
      narrow
        ? `Group / ${labels[metricIndex]}`
        : `${"Group".padEnd(labelWidth)}${"Hits".padStart(10)}${"Words".padStart(14)}${"Per 1,000".padStart(14)}`,
    ),
    ...(rows.length
      ? rows.slice(start, start + pageSize).map(row)
      : [
          h(
            Text,
            { key: "empty", color: "yellow" },
            "No groups match. Press r to reset the filter.",
          ),
        ]),
    h(
      Text,
      { dimColor: true },
      `${rows.length ? start + 1 : 0}–${Math.min(rows.length, start + pageSize)} of ${rows.length} groups`,
    ),
    h(Text, null, " "),
    h(
      Text,
      { color: "green" },
      spark ? `Recent observed UTC days: ${spark}` : "No dated trend available.",
    ),
    h(
      Text,
      { wrap: "wrap" },
      report.terms
        .slice(0, 8)
        .map((t) => `${safeTerminal(t.term)} × ${t.count}`)
        .join(" · ") || "No matched vocabulary.",
    ),
    ...(report.analysis
      ? [
          h(
            Text,
            { key: "analysis", dimColor: true },
            `${report.analysis.detector} · ${report.analysis.cachedMessages} cached · ${report.analysis.inferredMessages} inferred · ${report.analysis.skippedMessages} skipped`,
          ),
        ]
      : []),
    ...report.diagnostics
      .slice(0, 4)
      .map((d) =>
        h(
          Text,
          { key: `${d.agent}:${d.code}`, color: d.severity === "warning" ? "yellow" : "gray" },
          `${d.severity}: ${d.agent} / ${d.code} (${d.count})`,
        ),
      ),
    h(Text, null, " "),
    h(
      Text,
      { dimColor: true },
      editing
        ? "Type to filter · Enter/Esc return to navigation"
        : "g/Tab group · m metric · s sort · / search · r reset · ↑↓/jk scroll · q quit",
    ),
  );
}

export async function browse(report: Report): Promise<void> {
  const app = render(h(Dashboard, { report }), { exitOnCtrlC: true });
  try {
    await app.waitUntilExit();
  } finally {
    app.unmount();
  }
}
