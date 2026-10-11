// Optional real-browser acceptance check. Headless, isolated profile, no focus.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root, scratch } from "./build.mjs";

await mkdir(scratch, { recursive: true });
const fixture = await mkdtemp(join(scratch, "browser-proof-"));
const input = join(fixture, "session.jsonl");
await writeFile(
  input,
  [
    { type: "session", id: "private-session" },
    { type: "model_change", id: "model", parentId: null, model: "provider/model" },
    {
      type: "message",
      id: "u",
      parentId: "model",
      timestamp: "2026-10-11T09:00:00.000Z",
      message: { role: "user", content: "shit fix this" },
    },
  ]
    .map((r) => JSON.stringify(r))
    .join("\n") + "\n",
);
const output = join(fixture, "report.html");
const generated = spawnSync(
  process.execPath,
  [
    join(root, process.env.COREDAMN_PROOF_SOURCE === "1" ? "src/cli.ts" : "bin/coredamn.mjs"),
    "scan",
    "--path",
    `omp=${input}`,
    "--format",
    "html",
    "--output",
    output,
  ],
  { encoding: "utf8" },
);
assert.equal(generated.status, 0, generated.stderr);
const profile = join(fixture, "profile");
const browser = spawn(
  "chromium",
  [
    "--headless",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    pathToFileURL(output).href,
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let browserLog = "";
browser.stderr.on("data", (chunk) => {
  browserLog += String(chunk);
});
let socket;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    const text = await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(() => "");
    if (text) {
      port = Number(text.split("\n")[0]);
      break;
    }
    if (browser.exitCode !== null)
      throw new Error(`Headless Chromium exited: ${browserLog.slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(port, "Chrome debugging port wasn't available");
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const tab = tabs.find((t) => t.type === "page");
  assert.ok(tab);
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const external = [];
  const errors = [];
  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const promise = pending.get(data.id);
      pending.delete(data.id);
      data.error
        ? promise.reject(new Error(JSON.stringify(data.error)))
        : promise.resolve(data.result);
    }
    if (data.method === "Network.requestWillBeSent" && /^https?:/u.test(data.params.request.url))
      external.push(data.params.request.url);
    if (data.method === "Runtime.exceptionThrown") errors.push(data.params.exceptionDetails.text);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Page.enable");
  await send("Page.reload", { ignoreCache: true });
  for (let i = 0; i < 50; i++) {
    if (
      await evaluate(
        'document.readyState === "complete" && !!document.getElementById("result-count").textContent',
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await evaluate('document.getElementById("comparison-body").rows.length'), 1);
  assert.equal(await evaluate('document.getElementById("controls").hidden'), false);
  assert.equal(await evaluate('document.querySelectorAll(".daily-trend").length'), 2);
  assert.equal(await evaluate('document.querySelectorAll(".word-cloud span").length'), 1);
  assert.equal(await evaluate('document.getElementById("trend-rate").hidden'), true);
  assert.equal(
    await evaluate(
      `(() => {const input=document.getElementById("trend-metric");input.value="per1000Words";input.dispatchEvent(new Event("input"));return document.getElementById("trend-hits").hidden && !document.getElementById("trend-rate").hidden})()`,
    ),
    true,
  );
  const result = await evaluate(
    `(() => {const select=document.getElementById("group");select.value="byModel";select.dispatchEvent(new Event("input"));return document.getElementById("comparison-body").textContent})()`,
  );
  assert.match(result, /provider\/model/u);
  assert.equal(
    await evaluate(
      `(() => {const input=document.getElementById("search");input.value="does-not-exist";input.dispatchEvent(new Event("input"));return document.getElementById("comparison-body").rows.length})()`,
    ),
    0,
  );
  await evaluate(
    'document.getElementById("search").value="";document.getElementById("search").dispatchEvent(new Event("input"))',
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert.equal(
    await evaluate("document.documentElement.scrollWidth <= 390"),
    true,
    "mobile report mustn't overflow the viewport",
  );
  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await writeFile(join(fixture, "report-mobile.png"), Buffer.from(screenshot.data, "base64"));
  assert.deepEqual(external, [], "report made an external network request");
  assert.deepEqual(errors, []);
  process.stdout.write(
    `Browser proof passed: rendered HTML, model grouping, search, word cloud, trend metric, mobile layout, no external requests.\n${output}\n${join(fixture, "report-mobile.png")}\n`,
  );
} finally {
  socket?.close();
  browser.kill("SIGTERM");
}
