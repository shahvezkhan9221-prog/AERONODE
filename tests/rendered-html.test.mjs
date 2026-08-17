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
  assert.match(html, /FIRMWARE CHECK/);
  assert.match(html, /Waiting for firmware/);
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
  assert.match(page, /APPROXIMATE_USER_DISTANCE_METERS = 5/);
  assert.match(page, /exactly 5 metres from the red master flag/);
  assert.match(page, /Click map to place master/);
  assert.match(page, /enableHighAccuracy: false/);
  assert.match(page, /Local Wi-Fi\/USB reply/);
  assert.match(page, /voice_chunk/);
  assert.match(page, /Decoding voice note/);
  assert.match(page, /Voice note checksum verified/);
  const map = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/CommandMap.tsx", import.meta.url), "utf8"));
  assert.match(map, /maps\.googleapis\.com\/maps\/api\/js/);
  assert.match(map, /#e5484d/);
  assert.match(map, /#13aa7d/);
  assert.doesNotMatch(map, /leaflet|openstreetmap/i);
  assert.match(map, /pickingLocation/);
  assert.match(map, /Place the master node/);
});

test("ships authenticated LoRa encryption without committing a network key", async () => {
  const { readFile, access } = await import("node:fs/promises");
  const crypto = await readFile(new URL("../firmware/AeroCrypto.h", import.meta.url), "utf8");
  const firmware = await readFile(new URL("../firmware/aero_node_master_private_chat_gps.ino", import.meta.url), "utf8");
  const peer = await readFile(new URL("../firmware/secure_peer_example/secure_peer_example.ino", import.meta.url), "utf8");
  const field = await readFile(new URL("../firmware/espnow_field_node/espnow_field_node.ino", import.meta.url), "utf8");
  const relay = await readFile(new URL("../firmware/espnow_relay_node/espnow_relay_node.ino", import.meta.url), "utf8");
  const ignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(crypto, /mbedtls_gcm_crypt_and_tag/);
  assert.match(crypto, /mbedtls_gcm_auth_decrypt/);
  assert.match(crypto, /putULong64\("next-tx"/);
  assert.match(crypto, /ReplayRejected/);
  assert.match(firmware, /sendEncryptedRadio/);
  assert.match(firmware, /AES-256-GCM/);
  assert.match(firmware, /esp_now_register_recv_cb/);
  assert.match(firmware, /WIFI_AP_STA/);
  assert.match(peer, /AeroCrypto radioCrypto/);
  assert.match(field, /SOS_BUTTON_PIN = 27/);
  assert.match(field, /esp_now_send/);
  assert.match(relay, /FORWARDED AUTHENTICATED FRAME/);
  assert.match(relay, /ReplayRejected|result != AeroDecryptResult::Ok/);
  assert.match(ignore, /aero_network_secrets\.h/);
  await assert.rejects(access(new URL("../firmware/aero_network_secrets.h", import.meta.url)));
});

test("ships the one-ESP text and voice gateway", async () => {
  const { readFile } = await import("node:fs/promises");
  const firmware = await readFile(new URL("../firmware/aero_single_esp_voice_gateway/aero_single_esp_voice_gateway.ino", import.meta.url), "utf8");
  assert.match(firmware, /WiFi\.softAP\(WIFI_NAME\)/);
  assert.match(firmware, /server\.on\("\/voice"/);
  assert.match(firmware, /voice_chunk/);
  assert.match(firmware, /voice-complete/);
  assert.match(firmware, /5000-\(Date\.now\(\)-started\)/);
  assert.match(firmware, /encodeVoiceWav/);
  assert.match(firmware, /mime:'audio\/wav'/);
  assert.match(firmware, /chunk\.replace\(" ", "\+"\)/);
  assert.match(firmware, /voice-wav-v3/);
  assert.match(firmware, /checksum:encoded\.checksum/);
  assert.doesNotMatch(firmware, /#include <LoRa\.h>|#include <esp_now\.h>|aero_network_secrets/);
});
