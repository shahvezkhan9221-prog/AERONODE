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
  assert.match(html, /CONNECT ESP32/);
  assert.match(html, /LIVE OPERATIONS MAP/);
  assert.match(html, /SERIAL GATEWAY/);
  assert.match(html, /property="og:image" content="http:\/\/localhost\/og\.png"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("ships the expected local-first protocol hooks", async () => {
  const page = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/page.tsx", import.meta.url), "utf8"));
  assert.match(page, /baudRate: 115200/);
  assert.match(page, /TextDecoderStream/);
  assert.match(page, /type: "reply"/);
  assert.match(page, /\["sos", "message", "member", "user"\]/);
});
