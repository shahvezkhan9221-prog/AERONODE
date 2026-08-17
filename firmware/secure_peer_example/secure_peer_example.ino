#include <SPI.h>
#include <LoRa.h>
#include "aero_network_secrets.h"
#include "../AeroCrypto.h"

// Matching encrypted peer for bench testing. Type plaintext into this board's
// Serial Monitor; it crosses LoRa only inside an authenticated AES-256-GCM envelope.

#define LORA_SS 5
#define LORA_RST 14
#define LORA_DIO0 26
#define LORA_SCK 18
#define LORA_MISO 19
#define LORA_MOSI 23
#define LORA_FREQ 433E6

AeroCrypto radioCrypto(AERO_NETWORK_KEY, AERO_NODE_ID);

bool sendEncrypted(const String& plaintext) {
  uint8_t frame[255];
  size_t frameLength = 0;
  if (!radioCrypto.encrypt(reinterpret_cast<const uint8_t*>(plaintext.c_str()), plaintext.length(), frame, sizeof(frame), frameLength)) return false;
  LoRa.beginPacket();
  LoRa.write(frame, frameLength);
  return LoRa.endPacket() == 1;
}

void receiveEncrypted() {
  int packetSize = LoRa.parsePacket();
  if (!packetSize) return;
  uint8_t frame[255];
  size_t frameLength = 0;
  while (LoRa.available() && frameLength < sizeof(frame)) frame[frameLength++] = LoRa.read();
  uint8_t plaintext[AeroCrypto::kMaxPlaintextBytes + 1];
  size_t plaintextLength = 0;
  AeroDecryptResult result = radioCrypto.decrypt(frame, frameLength, plaintext, sizeof(plaintext), plaintextLength);
  if (result == AeroDecryptResult::Ok) {
    Serial.print("AUTHENTICATED RX: ");
    Serial.println(reinterpret_cast<const char*>(plaintext));
  } else {
    Serial.printf("REJECTED RX: %d\n", static_cast<int>(result));
  }
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(40);
  if (!radioCrypto.begin()) {
    Serial.println("Crypto configuration failed");
    while (true) delay(1000);
  }
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println("LoRa start failed");
    while (true) delay(1000);
  }
  LoRa.setTxPower(17);
  LoRa.setSpreadingFactor(7);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  LoRa.enableCrc();
  Serial.println("Secure Aero-Node peer ready");
}

void loop() {
  receiveEncrypted();
  if (Serial.available()) {
    String message = Serial.readStringUntil('\n');
    message.trim();
    if (message.length()) Serial.println(sendEncrypted(message) ? "ENCRYPTED TX OK" : "ENCRYPTED TX FAILED");
  }
}
