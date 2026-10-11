import type { Report } from "./types.ts";

export const escapeMarkup = (value: string): string =>
  value.replace(
    /[&<>"']/gu,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
export const visibleText = (value: string, max = 80): string =>
  [...value.replace(/[\p{Cc}\p{Cf}]/gu, " ")].slice(0, max).join("");

export function cloud(report: Report): string {
  const terms = report.terms.slice(0, 60);
  const max = Math.max(1, ...terms.map((t) => t.count));
  return `<div class="word-cloud" aria-label="Vocabulary sized by occurrence count">${
    terms
      .map(
        (t) =>
          `<span style="font-size:${Math.round(15 + 35 * Math.sqrt(t.count / max))}px" title="${escapeMarkup(`${visibleText(t.term, 200)}: ${t.count} ${t.category} occurrences`)}">${escapeMarkup(visibleText(t.term))}<small>${t.count}</small></span>`,
      )
      .join("") || "<p>No matched vocabulary in this selection.</p>"
  }</div>`;
}

export function trend(report: Report, metric: "hits" | "per1000Words" = "hits"): string {
  const rows = report.byDay
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/u.test(r.label))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (!rows.length) return '<p class="trend-empty">No dated messages in this selection.</p>';
  const first = Date.parse(rows[0]?.label ?? "");
  const last = Date.parse(rows.at(-1)?.label ?? "");
  const ceiling = Math.max(1, ...rows.map((r) => r[metric]));
  const x = (date: string) =>
    60 + (first === last ? 430 : ((Date.parse(date) - first) / (last - first)) * 860);
  const y = (value: number) => 230 - (value / ceiling) * 190;
  const points = rows.map((r) => `${x(r.label).toFixed(2)},${y(r[metric]).toFixed(2)}`).join(" ");
  const label = metric === "hits" ? "Occurrences" : "Occurrences per 1,000 user words";
  return `<svg class="daily-trend" viewBox="0 0 980 280" role="img" aria-label="${label} by UTC day"><title>${label} by UTC day</title><desc>${rows.length} observed days. Gaps connect observed days; missing days aren't reported as zero. Undated messages aren't plotted.</desc>
    ${[0, 0.5, 1].map((r) => `<path d="M60 ${y(r * ceiling)} H920" stroke="#393d30"/><text x="50" y="${y(r * ceiling) + 4}" text-anchor="end" fill="#b0b29e" font-size="12">${Number((r * ceiling).toFixed(1))}</text>`).join("")}
    <polyline points="${points}" fill="none" stroke="#d9fb6c" stroke-width="3" stroke-linejoin="round"/>
    ${rows.length <= 90 ? rows.map((r) => `<circle cx="${x(r.label)}" cy="${y(r[metric])}" r="4" fill="#d9fb6c"><title>${r.label}: ${r[metric]}</title></circle>`).join("") : ""}
    <text x="60" y="266" fill="#b0b29e" font-size="13">${rows[0]?.label}</text><text x="920" y="266" text-anchor="end" fill="#b0b29e" font-size="13">${rows.length > 1 ? rows.at(-1)?.label : ""}</text></svg>`;
}

export function shareCard(report: Report): string {
  const t = report.totals;
  const dates = report.byDay
    .map((r) => r.label)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/u.test(d))
    .sort();
  const range = `${report.filters.since ?? dates[0] ?? "all time"} to ${report.filters.until ?? dates.at(-1) ?? "latest"}`;
  const caption =
    report.analysis?.detector === "local" ? "locally extracted occurrences" : "dictionary matches";
  const terms = report.terms
    .slice(0, 4)
    .map((t) => `${visibleText(t.term, 18)} × ${t.count}`)
    .join("   /   ");
  const number = t.hits.toLocaleString("en");
  const headline = t.hits ? "A core dump of my patience." : "Patience intact. So far.";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Coredamn aggregate share card"><title>Coredamn aggregate share card</title>
  <rect width="1200" height="630" fill="#11120f"/><path d="M48 40H1152" stroke="#d9fb6c" stroke-width="5"/>
  <g font-family="DejaVu Sans, sans-serif"><text x="48" y="87" fill="#d9fb6c" font-size="25" font-weight="700">coredamn / patience report</text><text x="1152" y="87" text-anchor="end" fill="#b0b29e" font-size="19">${report.status} coverage</text>
  <text x="48" y="166" fill="#eeeece" font-size="53" font-weight="700">${headline}</text>
  <text x="48" y="315" fill="#d9fb6c" font-size="${number.length > 9 ? 88 : 120}" font-weight="700">${number}</text><text x="48" y="353" fill="#b0b29e" font-size="22">${caption}</text>
  <path d="M640 210V365" stroke="#393d30"/>
  <text x="690" y="252" fill="#eeeece" font-size="31">${t.profanity.toLocaleString("en")} profanity</text><text x="690" y="300" fill="#eeeece" font-size="31">${t.insults.toLocaleString("en")} insults</text><text x="690" y="348" fill="#b0b29e" font-size="21">${t.per1000Words} per 1,000 user words</text>
  <path d="M48 391H1152" stroke="#393d30"/><text x="48" y="431" fill="#eeeece" font-size="23">${escapeMarkup(terms || "No matched vocabulary.")}</text>
  <text x="48" y="481" fill="#b0b29e" font-size="21">${t.messages.toLocaleString("en")} human messages · ${t.words.toLocaleString("en")} user words</text>
  <text x="48" y="529" fill="#b0b29e" font-size="18">${escapeMarkup(range)} · UTC</text>
  <path d="M48 554H1152" stroke="#393d30"/><text x="48" y="592" fill="#b0b29e" font-size="16">${report.status === "partial" ? "Partial input or analysis. See report coverage notes." : "Local analysis. Counts don't establish intent."}</text><text x="1152" y="592" text-anchor="end" fill="#d9fb6c" font-size="16">No transcript text shared.</text></g></svg>`;
}
