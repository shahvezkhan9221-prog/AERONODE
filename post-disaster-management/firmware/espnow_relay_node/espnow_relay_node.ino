#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_idf_version.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "aero_network_secrets.h"
#include "../AeroCrypto.h"

// Authenticated one-forward flood relay. It extends the nearby ESP-NOW layer;
// it is not a replacement for the long-range LoRa backbone.

const uint8_t WIFI_CHANNEL = 6;
const uint8_t BROADCAST_MAC[6] = { 0xff, 0xff, 0xff, 0xff, 0xff, 0xff };
const size_t ESPNOW_MAX_FRAME_BYTES = 250;

struct RxFrame { uint8_t length; uint8_t data[ESPNOW_MAX_FRAME_BYTES]; };
QueueHandle_t rxQueue = nullptr;
AeroCrypto networkCrypto(AERO_NETWORK_KEY, AERO_NODE_ID);
unsigned long lastHeartbeatAt = 0;

void queueFrame(const uint8_t* data, int length) {
  if (!rxQueue || !data || length < 1 || length > static_cast<int>(ESPNOW_MAX_FRAME_BYTES)) return;
  RxFrame frame = {};
  frame.length = static_cast<uint8_t>(length);
  memcpy(frame.data, data, length);
  xQueueSend(rxQueue, &frame, 0);
}

#if ESP_IDF_VERSION_MAJOR >= 5
void onReceive(const esp_now_recv_info_t*, const uint8_t* data, int length) { queueFrame(data, length); }
#else
void onReceive(const uint8_t*, const uint8_t* data, int length) { queueFrame(data, length); }
#endif

bool broadcastEncrypted(const String& plaintext) {
  uint8_t frame[ESPNOW_MAX_FRAME_BYTES];
  size_t frameLength = 0;
  if (!networkCrypto.encrypt(reinterpret_cast<const uint8_t*>(plaintext.c_str()), plaintext.length(), frame, sizeof(frame), frameLength)) return false;
  return esp_now_send(BROADCAST_MAC, frame, frameLength) == ESP_OK;
}

void processRelayQueue() {
  RxFrame frame;
  while (rxQueue && xQueueReceive(rxQueue, &frame, 0) == pdTRUE) {
    uint8_t plaintext[AeroCrypto::kMaxPlaintextBytes + 1];
    size_t plaintextLength = 0;
    AeroDecryptResult result = networkCrypto.decrypt(frame.data, frame.length, plaintext, sizeof(plaintext), plaintextLength);
    if (result != AeroDecryptResult::Ok) continue; // Includes duplicate/replay suppression.
    delay(random(15, 55));
    if (esp_now_send(BROADCAST_MAC, frame.data, frame.length) == ESP_OK) {
      Serial.print("FORWARDED AUTHENTICATED FRAME: "); Serial.print(frame.length); Serial.println(" bytes");
    }
  }
}

bool beginEspNow() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  if (esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE) != ESP_OK) return false;
  rxQueue = xQueueCreate(10, sizeof(RxFrame));
  if (!rxQueue || esp_now_init() != ESP_OK || esp_now_register_recv_cb(onReceive) != ESP_OK) return false;
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST_MAC, sizeof(peer.peer_addr));
  peer.channel = WIFI_CHANNEL;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  return esp_now_add_peer(&peer) == ESP_OK || esp_now_is_peer_exist(BROADCAST_MAC);
}

void sendHeartbeat() {
  String node = "ER-" + String(AERO_NODE_ID, HEX);
  String json = "{\"type\":\"telemetry\",\"nodeId\":\"" + node +
    "\",\"label\":\"ESP-NOW Relay\",\"transport\":\"ESP-NOW relay\",\"encryption\":\"AES-256-GCM\",\"secure\":true}";
  broadcastEncrypted(json);
}

void setup() {
  Serial.begin(115200);
  if (!networkCrypto.begin() || !beginEspNow()) {
    Serial.println("RELAY START FAILED");
    while (true) delay(1000);
  }
  randomSeed(esp_random());
  Serial.print("ESP-NOW relay ready on channel 6. MAC: "); Serial.println(WiFi.macAddress());
}

void loop() {
  processRelayQueue();
  if (millis() - lastHeartbeatAt >= 10000) { lastHeartbeatAt = millis(); sendHeartbeat(); }
}
