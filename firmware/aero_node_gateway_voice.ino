#include <SPI.h>
#include <LoRa.h>

// Aero-Node COMMAND GATEWAY: LoRa <-> newline-delimited JSON over USB Serial.
// Flash this sketch to the ESP32 connected to the command laptop.

#define LORA_SS 5
#define LORA_RST 14
#define LORA_DIO0 26
#define LORA_SCK 18
#define LORA_MISO 19
#define LORA_MOSI 23
#define LORA_FREQ 433E6

const char* GATEWAY_ID = "MASTER";
const char* FIELD_NODE_ID = "FIELD-01";
const uint8_t VOICE_MAGIC = 0xA7;
const uint8_t VOICE_VERSION = 1;
const uint8_t VOICE_BEGIN = 0x30;
const uint8_t VOICE_DATA = 0x31;
const uint8_t VOICE_ACK = 0x32;
const uint8_t VOICE_END = 0x33;
const uint16_t VOICE_BEGIN_SEQUENCE = 0xFFFF;
const uint16_t VOICE_END_SEQUENCE = 0xFFFE;

uint16_t read16(const uint8_t* input) { return uint16_t(input[0]) | (uint16_t(input[1]) << 8); }
uint32_t read32(const uint8_t* input) {
  return uint32_t(input[0]) | (uint32_t(input[1]) << 8) |
    (uint32_t(input[2]) << 16) | (uint32_t(input[3]) << 24);
}
void write16(uint8_t* output, uint16_t value) { output[0] = value & 0xFF; output[1] = value >> 8; }
void write32(uint8_t* output, uint32_t value) {
  output[0] = value & 0xFF; output[1] = value >> 8; output[2] = value >> 16; output[3] = value >> 24;
}

String jsonEscape(String value) {
  value.replace("\\", "\\\\"); value.replace("\"", "\\\"");
  value.replace("\n", "\\n"); value.replace("\r", "");
  return value;
}

String safeRadioText(String value) {
  value.replace("|", "/"); value.replace("\n", " "); value.replace("\r", " ");
  return value;
}

String base64Encode(const uint8_t* data, size_t length) {
  static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  String result;
  result.reserve(((length + 2) / 3) * 4);
  for (size_t i = 0; i < length; i += 3) {
    uint32_t block = uint32_t(data[i]) << 16;
    if (i + 1 < length) block |= uint32_t(data[i + 1]) << 8;
    if (i + 2 < length) block |= data[i + 2];
    result += alphabet[(block >> 18) & 63]; result += alphabet[(block >> 12) & 63];
    result += i + 1 < length ? alphabet[(block >> 6) & 63] : '=';
    result += i + 2 < length ? alphabet[block & 63] : '=';
  }
  return result;
}

String part(const String& value, int index) {
  int start = 0;
  for (int current = 0; current < index; current++) {
    start = value.indexOf('|', start);
    if (start < 0) return "";
    start++;
  }
  int end = value.indexOf('|', start);
  if (end < 0) end = value.length();
  return value.substring(start, end);
}

void sendAck(uint32_t messageId, uint16_t sequence, uint16_t chunkCount) {
  uint8_t frame[12];
  frame[0] = VOICE_MAGIC; frame[1] = VOICE_VERSION; frame[2] = VOICE_ACK;
  write32(frame + 3, messageId); write16(frame + 7, sequence); write16(frame + 9, chunkCount); frame[11] = 0;
  delay(20);
  LoRa.beginPacket(); LoRa.write(frame, sizeof(frame)); LoRa.endPacket();
}

void emitVoiceBegin(uint32_t messageId, uint16_t chunkCount, const String& metadata) {
  String userId = part(metadata, 0), name = part(metadata, 1), samples = part(metadata, 2);
  String bytes = part(metadata, 3), checksum = part(metadata, 4), codec = part(metadata, 5);
  Serial.print("{\"type\":\"voice_begin\",\"messageId\":\""); Serial.print(messageId, HEX);
  Serial.print("\",\"userId\":\""); Serial.print(jsonEscape(userId));
  Serial.print("\",\"name\":\""); Serial.print(jsonEscape(name));
  Serial.print("\",\"sampleCount\":"); Serial.print(samples);
  Serial.print(",\"totalBytes\":"); Serial.print(bytes);
  Serial.print(",\"checksum\":"); Serial.print(checksum);
  Serial.print(",\"codec\":\""); Serial.print(jsonEscape(codec));
  Serial.print("\",\"chunkCount\":"); Serial.print(chunkCount);
  Serial.print(",\"nodeId\":\""); Serial.print(FIELD_NODE_ID); Serial.println("\"}");
}

void emitTextPacket(const String& packet, int rssi) {
  // USER|userId|name|priority|lat|lng|message
  String userId = part(packet, 1), name = part(packet, 2), priority = part(packet, 3);
  String lat = part(packet, 4), lng = part(packet, 5), message = part(packet, 6);
  String type = priority == "critical" ? "sos" : (message.length() ? "message" : "user");
  Serial.print("{\"type\":\""); Serial.print(type);
  Serial.print("\",\"nodeId\":\""); Serial.print(FIELD_NODE_ID);
  Serial.print("\",\"userId\":\""); Serial.print(jsonEscape(userId));
  Serial.print("\",\"name\":\""); Serial.print(jsonEscape(name));
  Serial.print("\",\"priority\":\""); Serial.print(jsonEscape(priority));
  Serial.print("\",\"lat\":"); Serial.print(lat.length() ? lat : "null");
  Serial.print(",\"lng\":"); Serial.print(lng.length() ? lng : "null");
  Serial.print(",\"message\":\""); Serial.print(jsonEscape(message));
  Serial.print("\",\"rssi\":"); Serial.print(rssi); Serial.println("}");
}

void handleLoRa() {
  int packetSize = LoRa.parsePacket();
  if (!packetSize) return;
  uint8_t packet[255];
  size_t length = 0;
  while (LoRa.available() && length < sizeof(packet)) packet[length++] = LoRa.read();
  int rssi = LoRa.packetRssi();
  if (length >= 12 && packet[0] == VOICE_MAGIC && packet[1] == VOICE_VERSION) {
    uint8_t type = packet[2];
    uint32_t messageId = read32(packet + 3);
    uint16_t sequence = read16(packet + 7);
    uint16_t chunks = read16(packet + 9);
    uint8_t payloadLength = packet[11];
    if (type == VOICE_ACK || length != size_t(12 + payloadLength)) return;
    sendAck(messageId, sequence, chunks);
    if (type == VOICE_BEGIN && sequence == VOICE_BEGIN_SEQUENCE) {
      String metadata;
      for (uint8_t i = 0; i < payloadLength; i++) metadata += char(packet[12 + i]);
      emitVoiceBegin(messageId, chunks, metadata);
    } else if (type == VOICE_DATA && sequence < chunks) {
      Serial.print("{\"type\":\"voice_chunk\",\"messageId\":\""); Serial.print(messageId, HEX);
      Serial.print("\",\"index\":"); Serial.print(sequence);
      Serial.print(",\"data\":\""); Serial.print(base64Encode(packet + 12, payloadLength));
      Serial.print("\",\"nodeId\":\""); Serial.print(FIELD_NODE_ID); Serial.println("\"}");
    } else if (type == VOICE_END && sequence == VOICE_END_SEQUENCE) {
      Serial.print("{\"type\":\"voice_end\",\"messageId\":\""); Serial.print(messageId, HEX);
      Serial.print("\",\"nodeId\":\""); Serial.print(FIELD_NODE_ID); Serial.println("\"}");
    }
    return;
  }
  String text;
  for (size_t i = 0; i < length; i++) text += char(packet[i]);
  if (text.startsWith("USER|")) emitTextPacket(text, rssi);
  else if (text.startsWith("NODE|")) {
    Serial.print("{\"type\":\"telemetry\",\"nodeId\":\""); Serial.print(jsonEscape(part(text, 1)));
    Serial.print("\",\"label\":\"Field Aero-Node\",\"clients\":"); Serial.print(part(text, 2));
    Serial.print(",\"rssi\":"); Serial.print(rssi); Serial.println("}");
  }
  else Serial.println("{\"type\":\"message\",\"nodeId\":\"FIELD-01\",\"userId\":\"LEGACY\",\"message\":\"" + jsonEscape(text) + "\"}");
}

String extractJsonString(const String& json, const String& key) {
  String marker = "\"" + key + "\":\"";
  int start = json.indexOf(marker);
  if (start < 0) return "";
  start += marker.length();
  String result;
  bool escaped = false;
  for (int i = start; i < json.length(); i++) {
    char c = json[i];
    if (escaped) { result += c == 'n' ? '\n' : c; escaped = false; }
    else if (c == '\\') escaped = true;
    else if (c == '"') break;
    else result += c;
  }
  return result;
}

void handleSerialCommand() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n'); line.trim();
  if (!line.length()) return;
  String target = extractJsonString(line, "to");
  String message = extractJsonString(line, "message");
  if (!target.length() || !message.length()) return;
  String packet = "CMD|" + safeRadioText(target) + "|" + safeRadioText(message);
  LoRa.beginPacket(); LoRa.print(packet); LoRa.endPacket();
}

void setup() {
  Serial.begin(115200); Serial.setTimeout(30);
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) { Serial.println("{\"type\":\"error\",\"message\":\"LoRa start failed\"}"); while (true) delay(1000); }
  LoRa.setTxPower(17); LoRa.setSpreadingFactor(7); LoRa.setSignalBandwidth(125E3); LoRa.setCodingRate4(5); LoRa.enableCrc();
  Serial.println("{\"type\":\"telemetry\",\"nodeId\":\"MASTER\",\"label\":\"Command gateway\",\"clients\":0}");
}

void loop() {
  handleLoRa();
  handleSerialCommand();
}
