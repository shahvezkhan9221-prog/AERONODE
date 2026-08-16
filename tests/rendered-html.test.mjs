import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html", host: "localhost" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Aero-Node command surface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Aero-Node Rescue Command/i);
  assert.match(html, /Connect ESP32/);
  assert.match(html, /Live map/);
  assert.match(html, /Conversations/);
  assert.match(html, /Traffic/);
  assert.match(html, /Use laptop location/);
  assert.match(html, /Wi-Fi users/);
  assert.match(html, /Recent check-ins/);
  assert.match(html, /No one checked in/);
  assert.match(html, />0(?:<!-- -->)?<\/strong><small>Checked in/);
  assert.doesNotMatch(html, /Unknown survivor|Recon Team|AN-01 heartbeat/);
  assert.match(html, /property="og:image" content="http:\/\/localhost\/og-v2\.png"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("ships the expected local-first protocol hooks", async () => {
  const page = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/page.tsx", import.meta.url), "utf8"));
  assert.match(page, /baudRate: 115200/);
  assert.match(page, /readable\.getReader\(\)/);
  assert.match(page, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(page, /packet\.clients/);
  assert.match(page, /JSON\.stringify\(\{ type: "command", to: selected\.id, message \}\)/);
  assert.match(page, /\["user", "member", "location", "message", "sos"\]/);
  assert.match(page, /selectedMessages/);
  assert.match(page, /locationKind: "approximate"/);
  assert.match(page, /Mapped near master · approximate/);
  const map = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/CommandMap.tsx", import.meta.url), "utf8"));
  assert.match(map, /maps\.googleapis\.com\/maps\/api\/js/);
  assert.match(map, /#e5484d/);
  assert.match(map, /#13aa7d/);
  assert.doesNotMatch(map, /leaflet|openstreetmap/i);
});
