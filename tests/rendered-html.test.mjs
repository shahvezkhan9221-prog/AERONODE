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
  assert.match(html, /property="og:image" content="http:\/\/localhost\/og-v3\.png"/);
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
  assert.match(page, /Click map to place master/);
  assert.match(page, /enableHighAccuracy: false/);
  assert.match(page, /type === "voice_begin"/);
  assert.match(page, /type === "voice_chunk"/);
  assert.match(page, /type === "voice_end"/);
  assert.match(page, /createVoiceUrl/);
  assert.match(page, /<audio[^>]+controls/);
  const codec = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/voiceCodec.ts", import.meta.url), "utf8"));
  assert.match(codec, /VOICE_CODEC = "cvsd-4k-v1"/);
  assert.match(codec, /VOICE_SAMPLE_RATE = 4000/);
  assert.match(codec, /fnv1a32/);
  const map = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/CommandMap.tsx", import.meta.url), "utf8"));
  assert.match(map, /maps\.googleapis\.com\/maps\/api\/js/);
  assert.match(map, /#e5484d/);
  assert.match(map, /#13aa7d/);
  assert.doesNotMatch(map, /leaflet|openstreetmap/i);
  assert.match(map, /pickingLocation/);
  assert.match(map, /Place the master node/);
});

test("ships matching reliable voice firmware for field and gateway nodes", async () => {
  const { readFile } = await import("node:fs/promises");
  const field = await readFile(new URL("../firmware/aero_node_field_voice.ino", import.meta.url), "utf8");
  const gateway = await readFile(new URL("../firmware/aero_node_gateway_voice.ino", import.meta.url), "utf8");
  for (const source of [field, gateway]) {
    assert.match(source, /VOICE_MAGIC = 0xA7/);
    assert.match(source, /VOICE_BEGIN = 0x30/);
    assert.match(source, /VOICE_DATA = 0x31/);
    assert.match(source, /VOICE_ACK = 0x32/);
    assert.match(source, /VOICE_END = 0x33/);
    assert.match(source, /LORA_FREQ 433E6/);
  }
  assert.match(field, /server\.on\("\/voice"/);
  assert.match(field, /MAX_RETRIES = 4/);
  assert.match(field, /type="file" accept="audio\/\*" capture/);
  assert.match(field, /cvsd-4k-v1/);
  assert.match(field, /messages\?userId=/);
  assert.match(gateway, /base64Encode/);
  assert.match(gateway, /voice_chunk/);
  assert.match(gateway, /handleSerialCommand/);
});
