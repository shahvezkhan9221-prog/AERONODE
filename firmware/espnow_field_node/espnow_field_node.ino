#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_idf_version.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "aero_network_secrets.h"
#include "../AeroCrypto.h"

// ESP-NOW field node for the hybrid Aero-Node demo.
// Type a message at 115200 baud or press GPIO 27 for an SOS.

const uint8_t WIFI_CHANNEL = 6;
const uint8_t SOS_BUTTON_PIN = 27;
const uint8_t BROADCAST_MAC[6] = { 0xff, 0xff, 0xff, 0xff, 0xff, 0xff };
const size_t ESPNOW_MAX_FRAME_BYTES = 250;

struct RxFrame { uint8_t length; uint8_t data[ESPNOW_MAX_FRAME_BYTES]; };
QueueHandle_t rxQueue = nullptr;
AeroCrypto networkCrypto(AERO_NETWORK_KEY, AERO_NODE_ID);
unsigned long lastHeartbeatAt = 0;
unsigned long lastButtonAt = 0;

String jsonEscape(String value) {
  value.replace("\\", "\\\\"); value.replace("\"", "\\\"");
  value.replace("\n", "\\n"); value.replace("\r", "");
  return value;
}

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

bool sendEncrypted(const String& plaintext) {
  uint8_t frame[ESPNOW_MAX_FRAME_BYTES];
  size_t frameLength = 0;
  if (!networkCrypto.encrypt(reinterpret_cast<const uint8_t*>(plaintext.c_str()), plaintext.length(), frame, sizeof(frame), frameLength)) return false;
  return esp_now_send(BROADCAST_MAC, frame, frameLength) == ESP_OK;
}

String nodeLabel() { return "EN-" + String(AERO_NODE_ID, HEX); }

void sendPersonEvent(const String& type, const String& priority, const String& message) {
  String node = nodeLabel();
  String json = "{\"type\":\"" + type + "\",\"nodeId\":\"" + node +
    "\",\"userId\":\"BTN-" + String(AERO_NODE_ID, HEX) +
    "\",\"name\":\"ESP-NOW field user\",\"priority\":\"" + priority +
    "\",\"message\":\"" + jsonEscape(message) + "\"}";
  Serial.println(sendEncrypted(json) ? "ENCRYPTED ESP-NOW TX OK" : "ESP-NOW TX FAILED");
}

void sendHeartbeat() {
  String json = "{\"type\":\"telemetry\",\"nodeId\":\"" + nodeLabel() +
    "\",\"label\":\"ESP-NOW Field Node\",\"transport\":\"ESP-NOW\",\"encryption\":\"AES-256-GCM\",\"secure\":true}";
  sendEncrypted(json);
}

void processIncoming() {
  RxFrame frame;
  while (rxQueue && xQueueReceive(rxQueue, &frame, 0) == pdTRUE) {
    uint8_t plaintext[AeroCrypto::kMaxPlaintextBytes + 1];
    size_t plaintextLength = 0;
    if (networkCrypto.decrypt(frame.data, frame.length, plaintext, sizeof(plaintext), plaintextLength) == AeroDecryptResult::Ok) {
      Serial.print("AUTHENTICATED COMMAND: ");
      Serial.println(reinterpret_cast<const char*>(plaintext));
    }
  }
}

bool beginEspNow() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  if (esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE) != ESP_OK) return false;
  rxQueue = xQueueCreate(8, sizeof(RxFrame));
  if (!rxQueue || esp_now_init() != ESP_OK || esp_now_register_recv_cb(onReceive) != ESP_OK) return false;
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST_MAC, sizeof(peer.peer_addr));
  peer.channel = WIFI_CHANNEL;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false; // AES-256-GCM protects the broadcast payload.
  return esp_now_add_peer(&peer) == ESP_OK || esp_now_is_peer_exist(BROADCAST_MAC);
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(50);
  pinMode(SOS_BUTTON_PIN, INPUT_PULLUP);
  if (!networkCrypto.begin() || !beginEspNow()) {
    Serial.println("FIELD NODE START FAILED");
    while (true) delay(1000);
  }
  Serial.print("ESP-NOW field node ready on channel 6. MAC: ");
  Serial.println(WiFi.macAddress());
}

void loop() {
  processIncoming();
  if (millis() - lastHeartbeatAt >= 10000) { lastHeartbeatAt = millis(); sendHeartbeat(); }
  if (digitalRead(SOS_BUTTON_PIN) == LOW && millis() - lastButtonAt > 1200) {
    lastButtonAt = millis();
    sendPersonEvent("sos", "critical", "Physical SOS button pressed");
  }
  if (Serial.available()) {
    String message = Serial.readStringUntil('\n'); message.trim();
    // Keep the JSON plus AES-GCM envelope below ESP-NOW's 250-byte payload limit.
    if (message.length()) sendPersonEvent("message", "normal", message.substring(0, 80));
  }
}
