import { createHash } from "node:crypto";
import type { Breakdown, Report } from "./types.ts";
import { cloud, trend } from "./visuals.ts";

export function safeTerminal(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, " ").slice(0, 180);
}
export function terminal(report: Report): string {
  const n = report.totals;
  const lines = [
    "coredamn · a core dump of your patience",
    "",
    `${n.hits} matches · ${n.profanity} profanity · ${n.insults} insults`,
    `${n.messages} human messages · ${n.words} user words · ${n.per1000Words} matches / 1,000 words`,
    `Coverage: ${report.status} · ${report.filesRead} files · ${report.duplicatesRemoved} duplicates removed`,
    "",
    "Agent                  Matches    Words    Per 1,000",
  ];
  for (const row of report.byAgent)
    lines.push(
      `${safeTerminal(row.label).padEnd(22)} ${String(row.hits).padStart(7)} ${String(row.words).padStart(8)} ${String(row.per1000Words).padStart(12)}`,
    );
  if (report.terms.length)
    lines.push(
      "",
      `Matched terms: ${report.terms
        .slice(0, 15)
        .map((t) => `${safeTerminal(t.term)} ${t.count}`)
        .join(" · ")}`,
    );
  if (report.unknownDates) lines.push(`${report.unknownDates} messages have no reliable date.`);
  for (const d of report.diagnostics)
    lines.push(`Coverage ${d.severity}: ${d.agent} / ${d.code} (${d.count})`);
  if (report.analysis)
    lines.push(
      `Detector: ${report.analysis.detector} · ${report.analysis.cachedMessages} cached · ${report.analysis.inferredMessages} inferred · ${report.analysis.skippedMessages} skipped`,
    );
  lines.push(
    "",
    report.analysis?.detector === "local"
      ? "Local model estimates aren't calibrated probabilities. See coverage for skipped work."
      : "Dictionary matches aren't a measure of hostility. Code blocks and URLs are excluded.",
  );
  return `${lines.join("\n")}\n`;
}
const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/gu,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
function table(rows: Breakdown[], label: string): string {
  return `<table><caption>${escapeHtml(label)}</caption><thead><tr><th scope="col">${escapeHtml(label)}</th><th scope="col">Matches</th><th scope="col">User words</th><th scope="col">Per 1,000 words</th></tr></thead><tbody>${rows.map((r) => `<tr><th scope="row">${escapeHtml(r.label)}</th><td>${r.hits}</td><td>${r.words}</td><td>${r.per1000Words}</td></tr>`).join("") || '<tr><td colspan="4">No messages in this selection.</td></tr>'}</tbody></table>`;
}
const script = `
const report = JSON.parse(document.getElementById("report-data").textContent);
const select = document.getElementById("group");
const metric = document.getElementById("metric");
const search = document.getElementById("search");
function render() {
  const rows = report[select.value].filter(row => row.label.toLowerCase().includes(search.value.toLowerCase()));
  rows.sort((a,b) => b[metric.value]-a[metric.value] || a.label.localeCompare(b.label));
  const body = document.getElementById("comparison-body"); body.replaceChildren();
  const max = Math.max(1,...rows.map(row => row[metric.value]));
  for (const row of rows) {
    const tr = document.createElement("tr");
    const name = document.createElement("th"); name.scope = "row";name.textContent = row.label;
    const bar = document.createElement("span");bar.className = "bar";bar.style.width = (row[metric.value]/max*100)+"%";name.append(bar);tr.append(name);
    for (const key of ["hits","words","per1000Words"]) {const td = document.createElement("td");td.textContent = row[key].toLocaleString();tr.append(td);}
    body.append(tr);
  }
  document.getElementById("result-count").textContent = rows.length+(rows.length === 1 ? " group" : " groups");
}
for (const input of [select,metric,search]) input.addEventListener("input",render);
document.getElementById("controls").hidden = false;render();
document.getElementById("trend-metric").addEventListener("input",event=>{
  document.getElementById("trend-hits").hidden=event.target.value!=="hits";
  document.getElementById("trend-rate").hidden=event.target.value!=="per1000Words";
});
`;
export function html(report: Report): string {
  const data = JSON.stringify(report).replace(
    /[<>&\u2028\u2029]/gu,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const hash = createHash("sha256").update(script).digest("base64");
  const t = report.totals;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'">
<title>coredamn · transcript report</title><style>
:root{color-scheme:dark;--bg:#11120f;--paper:#1b1d18;--ink:#eeeece;--muted:#b0b29e;--accent:#d9fb6c;--line:#393d30;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);line-height:1.6}main{max-width:1100px;padding:44px 24px 80px;margin:auto}header{border-top:3px solid var(--accent);padding-top:20px;display:flex;justify-content:space-between;align-items:start;gap:24px}.brand{color:var(--accent);font-size:18px;font-weight:bold;letter-spacing:-1px}h1{font-family:system-ui,sans-serif;font-size:clamp(38px,7vw,76px);line-height:1.02;letter-spacing:-3px;margin:48px 0 18px;max-width:750px}h2{font-family:system-ui,sans-serif;font-size:26px;letter-spacing:-.6px;margin-top:0}p{color:var(--muted);max-width:730px}.status{border:1px solid var(--line);padding:4px 12px;color:var(--accent)}.stats{display:grid;grid-template-columns:2fr 1fr 1fr;margin:40px 0;border-block:1px solid var(--line)}.stat{padding:24px 12px;border-right:1px solid var(--line)}.stat:first-child{padding-left:0}.stat:last-child{border:0}.number{font-family:system-ui,sans-serif;font-size:52px;line-height:1.2;color:var(--accent);font-variant-numeric:tabular-nums}.label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:1px}section{margin:44px 0}#controls{display:flex;flex-wrap:wrap;gap:18px;align-items:end;margin-bottom:18px}label{display:flex;flex-direction:column;font-size:12px;gap:5px}select,input{font:inherit;background:var(--paper);color:var(--ink);border:1px solid var(--line);padding:9px;min-height:42px}input{max-width:220px}:focus-visible{outline:2px solid var(--accent);outline-offset:3px}table{width:100%;border-collapse:collapse;font-size:13px}caption{text-align:left;color:var(--muted);padding-bottom:10px}th,td{border-bottom:1px solid var(--line);padding:12px 8px;text-align:right;overflow-wrap:anywhere}th:first-child{text-align:left}tbody th{font-weight:normal;position:relative;isolation:isolate}.bar{position:absolute;left:0;bottom:0;top:0;background:var(--accent);opacity:.08;z-index:-1}thead{color:var(--muted)}.scroll{overflow-x:auto}.terms{display:flex;flex-wrap:wrap;gap:8px}.term{padding:7px 11px;border:1px solid var(--line);background:var(--paper);font-size:13px}.term small{color:var(--muted)}details{border-top:1px solid var(--line);padding:20px 0}summary{cursor:pointer;color:var(--muted)}footer{margin-top:60px;font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:18px}ul{padding-left:22px}.note{border-left:3px solid var(--accent);padding-left:16px}noscript{color:var(--muted)}@media(max-width:600px){main{padding:24px 16px}.stats{grid-template-columns:1fr}.stat{padding:14px 0;border-right:0;border-bottom:1px solid var(--line)}.number{font-size:40px}h1{letter-spacing:-2px}table{font-size:12px}}
.word-cloud{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:14px 24px;padding:28px 10px;min-height:150px;border-block:1px solid var(--line)}.word-cloud span{color:var(--accent);line-height:1.3;overflow-wrap:anywhere;max-width:100%;font-weight:600}.word-cloud small{font-size:12px;color:var(--muted);margin-left:6px}.daily-trend{display:block;width:100%;height:auto;min-width:0}.trend-control{width:max-content;margin-bottom:12px}.chart-note{font-size:12px}[hidden]{display:none!important}
</style></head><body><main><header><div class="brand">coredamn / 01</div><span class="status">${report.status} coverage</span></header>
<h1>A core dump of<br>your patience.</h1><p>Human messages across your coding agents. ${report.analysis?.detector === "local" ? "Occurrences extracted by a local model" : "Dictionary matches"}, with the words you wrote as the denominator.</p>
<div class="stats"><div class="stat"><div class="number">${t.hits.toLocaleString("en")}</div><div class="label">matches · ${t.profanity} profanity / ${t.insults} insults</div></div><div class="stat"><div class="number">${t.per1000Words}</div><div class="label">per 1,000 user words</div></div><div class="stat"><div class="number">${t.messages.toLocaleString("en")}</div><div class="label">human messages · ${t.words} words</div></div></div>
${report.status === "partial" ? '<p class="note">Some input could not be counted reliably. Read the coverage notes below before comparing totals.</p>' : ""}
<section><h2>Where the words landed</h2><div id="controls" hidden><label>Group by<select id="group"><option value="byAgent">Agent</option><option value="byModel">Model</option><option value="bySession">Session</option><option value="byDay">Day, UTC</option></select></label><label>Sort by<select id="metric"><option value="hits">Matches</option><option value="per1000Words">Per 1,000 words</option><option value="words">User words</option></select></label><label>Find a group<input id="search" type="search" placeholder="Filter groups"></label><span id="result-count" aria-live="polite"></span></div><div class="scroll"><table><caption>Dictionary matches by selected group</caption><thead><tr><th scope="col">Group</th><th scope="col">Matches</th><th scope="col">User words</th><th scope="col">Per 1,000 words</th></tr></thead><tbody id="comparison-body">${report.byAgent.map((r) => `<tr><th scope="row">${escapeHtml(r.label)}</th><td>${r.hits}</td><td>${r.words}</td><td>${r.per1000Words}</td></tr>`).join("")}</tbody></table></div><noscript>Interactive filters need JavaScript. All breakdowns are available below.</noscript></section>
<section><h2>Patience, over time</h2><label class="trend-control">Chart metric<select id="trend-metric"><option value="hits">Occurrences</option><option value="per1000Words">Per 1,000 user words</option></select></label><div id="trend-hits">${trend(report)}</div><div id="trend-rate" hidden>${trend(report, "per1000Words")}</div><p class="chart-note">UTC days. Lines connect observed days; gaps aren't assumed to be zero. Undated messages aren't plotted.</p></section>
<section><h2>The vocabulary</h2>${cloud(report)}<details><summary>Exact counts and categories</summary><div class="terms">${report.terms.map((term) => `<span class="term">${escapeHtml(term.term)} <small>${term.count} · ${term.category} · ${term.language}</small></span>`).join("") || "No matched vocabulary."}</div></details></section>
<details><summary>All breakdowns, including the timeline</summary>${table(report.byModel, "Model")}${table(report.bySession, "Session")}${table(report.byDay, "Day, UTC")}</details>
<details open><summary>Coverage and counting rules</summary><p>${report.filesRead} files read. ${report.duplicatesRemoved} duplicate messages removed. ${report.unknownDates} messages without reliable dates. Date range ${escapeHtml(report.filters.since ?? "all time")} through ${escapeHtml(report.filters.until ?? "latest")}.</p>${report.analysis ? `<p>Detector: ${report.analysis.detector}. ${report.analysis.cachedMessages} cached, ${report.analysis.inferredMessages} inferred, ${report.analysis.skippedMessages} skipped out of ${report.analysis.eligibleMessages} eligible messages. ${escapeHtml(report.analysis.policy)}</p>` : ""}<ul>${report.diagnostics.map((d) => `<li>${d.severity}: ${d.agent} / ${escapeHtml(d.code)}: ${d.count}</li>`).join("") || "<li>No parsing or input warnings.</li>"}</ul><p>Code blocks, inline code, URLs, tool output and recognized injected context are excluded. User words use Unicode word segmentation. Dates are UTC. Missing models and dates stay unknown. Session labels are stable pseudonyms. ${report.analysis?.detector === "local" ? "Local model scores are estimates, not calibrated probabilities. Counts use source-validated extracted occurrences. Language is undetermined." : "These are dictionary matches, not a judgment about intent."}</p></details>
<footer>Offline report · ${escapeHtml(report.ruleset)} · ${escapeHtml(report.generatedAt)}<br>No transcript text or input paths included. No fonts, scripts, telemetry or requests loaded from the network.</footer>
<script id="report-data" type="application/json">${data}</script><script>${script}</script></main></body></html>`;
}
