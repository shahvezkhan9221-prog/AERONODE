/* SENTINEL-MESH · NODE 01 · MPU-6500 EARTHQUAKE/VIBRATION
 * Direct USB mode for the dashboard's Node 01 "Connect port" button.
 * Output: exactly one JSON object per line at 115200 baud.
 */
#include <Wire.h>
#include <TinyGPSPlus.h>

constexpr uint8_t MPU_SDA = 21, MPU_SCL = 22;
constexpr uint8_t SW420_PIN = 27, SOUND_PIN = 26, LED_PIN = 25;
constexpr uint8_t GPS_RX_PIN = 16, GPS_TX_PIN = 18;
constexpr uint8_t SW420_ACTIVE_STATE = LOW, SOUND_ACTIVE_STATE = LOW;
constexpr uint32_t SERIAL_BAUD = 115200, GPS_BAUD = 9600;
constexpr uint32_t SAMPLE_INTERVAL_MS = 20, PACKET_INTERVAL_MS = 1500;
constexpr int BATTERY_PERCENT = 100;
constexpr uint8_t MPU_ADDRESS = 0x68, WHO_AM_I_REG = 0x75;
constexpr uint8_t PWR_MGMT_1 = 0x6B, CONFIG_REG = 0x1A, SMPLRT_DIV = 0x19;
constexpr uint8_t GYRO_CONFIG = 0x1B, ACCEL_CONFIG = 0x1C, ACCEL_XOUT_H = 0x3B;
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
float gravityX = 0, gravityY = 0, gravityZ = 1, packetPeakG = 0;
unsigned long lastSample = 0, lastPacket = 0;
void writeRegister(uint8_t reg, uint8_t value) { Wire.beginTransmission(MPU_ADDRESS); Wire.write(reg); Wire.write(value); Wire.endTransmission(); }
uint8_t readRegister(uint8_t reg) { Wire.beginTransmission(MPU_ADDRESS); Wire.write(reg); if (Wire.endTransmission(false) != 0) return 0xFF; Wire.requestFrom(MPU_ADDRESS, (uint8_t)1); return Wire.available() ? Wire.read() : 0xFF; }
bool readBytes(uint8_t reg, uint8_t* buffer, uint8_t length) { Wire.beginTransmission(MPU_ADDRESS); Wire.write(reg); if (Wire.endTransmission(false) != 0) return false; if (Wire.requestFrom(MPU_ADDRESS, length) != length) return false; for (uint8_t i = 0; i < length; i++) buffer[i] = Wire.read(); return true; }
bool setupMPU6500() { const uint8_t id = readRegister(WHO_AM_I_REG); if (id != 0x70 && id != 0x71 && id != 0x73) return false; writeRegister(PWR_MGMT_1, 0x80); delay(100); writeRegister(PWR_MGMT_1, 0x01); delay(100); writeRegister(CONFIG_REG, 0x03); writeRegister(SMPLRT_DIV, 9); writeRegister(GYRO_CONFIG, 0x08); writeRegister(ACCEL_CONFIG, 0x10); delay(100); return true; }
bool readAcceleration(float& x, float& y, float& z) { uint8_t data[6]; if (!readBytes(ACCEL_XOUT_H, data, sizeof(data))) return false; x = (int16_t)((data[0] << 8) | data[1]) / 4096.0f; y = (int16_t)((data[2] << 8) | data[3]) / 4096.0f; z = (int16_t)((data[4] << 8) | data[5]) / 4096.0f; return true; }
void calibrateGravity() { float sx = 0, sy = 0, sz = 0; int valid = 0; for (int i = 0; i < 150; i++) { float x, y, z; if (readAcceleration(x, y, z)) { sx += x; sy += y; sz += z; valid++; } delay(10); } if (valid) { gravityX = sx / valid; gravityY = sy / valid; gravityZ = sz / valid; } }
void sampleMotion() { float x, y, z; if (!readAcceleration(x, y, z)) return; constexpr float alpha = 0.01f; gravityX += alpha * (x - gravityX); gravityY += alpha * (y - gravityY); gravityZ += alpha * (z - gravityZ); const float lx = x - gravityX, ly = y - gravityY, lz = z - gravityZ; packetPeakG = max(packetPeakG, sqrtf(lx * lx + ly * ly + lz * lz)); }
void readGPS() { while (gpsSerial.available()) gps.encode(gpsSerial.read()); }
void sendDashboardPacket() { const int shock = digitalRead(SW420_PIN) == SW420_ACTIVE_STATE; const int sound = digitalRead(SOUND_PIN) == SOUND_ACTIVE_STATE; String packet = "{\"nodeId\":\"node-1\",\"battery\":" + String(BATTERY_PERCENT) + ",\"sensors\":{\"acceleration\":" + String(packetPeakG, 4) + ",\"shock\":" + String(shock) + ",\"sound\":" + String(sound) + "}"; if (gps.location.isValid() && gps.location.age() < 10000) packet += ",\"location\":{\"lat\":" + String(gps.location.lat(), 6) + ",\"lng\":" + String(gps.location.lng(), 6) + "}"; packet += "}"; Serial.println(packet); packetPeakG = 0; digitalWrite(LED_PIN, HIGH); delay(20); digitalWrite(LED_PIN, LOW); }
void setup() { Serial.begin(SERIAL_BAUD); pinMode(SW420_PIN, INPUT_PULLUP); pinMode(SOUND_PIN, INPUT_PULLUP); pinMode(LED_PIN, OUTPUT); Wire.begin(MPU_SDA, MPU_SCL); Wire.setClock(400000); gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN); if (!setupMPU6500()) { Serial.println("MPU6500 missing: expected WHO_AM_I 0x70/0x71/0x73"); while (true) { digitalWrite(LED_PIN, !digitalRead(LED_PIN)); delay(250); } } calibrateGravity(); lastPacket = millis(); }
void loop() { readGPS(); const unsigned long now = millis(); if (now - lastSample >= SAMPLE_INTERVAL_MS) { lastSample = now; sampleMotion(); } if (now - lastPacket >= PACKET_INTERVAL_MS) { lastPacket = now; sendDashboardPacket(); } }
