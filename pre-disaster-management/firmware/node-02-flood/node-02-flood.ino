#include <Wire.h>
#include <Adafruit_BMP280.h>

// ESP32 + BMP280 + FC-28 + MH-RD + float switch. USB Serial is the primary dashboard link.
constexpr int SOIL_PIN = 32, RAIN_ANALOG_PIN = 33, RAIN_DIGITAL_PIN = 25, FLOAT_PIN = 27;
constexpr int DRY_SOIL_ADC = 3200, WET_SOIL_ADC = 1250; // Calibrate with your own probe.
constexpr int DRY_RAIN_ADC = 3900, WET_RAIN_ADC = 1200; // Calibrate dry and fully wet.
constexpr int BATTERY_PERCENT = 100; // Replace with a calibrated divider reading when fitted.
constexpr unsigned long SEND_MS = 1570; // Offset from Node 01 to reduce collisions.

Adafruit_BMP280 bmp;
unsigned long lastSend = 0;

float percentWet(int raw, int dry, int wet) {
  return constrain((dry - raw) * 100.0f / (dry - wet), 0.0f, 100.0f);
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  pinMode(RAIN_DIGITAL_PIN, INPUT);
  pinMode(FLOAT_PIN, INPUT_PULLUP);
  Wire.begin(21, 22);
  if (!bmp.begin(0x76) && !bmp.begin(0x77)) Serial.println("BMP280 not found; sending null context values");
  delay(650);
}

void loop() {
  if (millis() - lastSend < SEND_MS) return;
  lastSend = millis();
  const float moisture = percentWet(analogRead(SOIL_PIN), DRY_SOIL_ADC, WET_SOIL_ADC);
  const float rain = percentWet(analogRead(RAIN_ANALOG_PIN), DRY_RAIN_ADC, WET_RAIN_ADC);
  const int waterHigh = digitalRead(FLOAT_PIN) == LOW ? 1 : 0; // Reverse if your switch is normally closed.
  const float temperature = bmp.sensorID() ? bmp.readTemperature() : NAN;
  const float pressure = bmp.sensorID() ? bmp.readPressure() / 100.0f : NAN;
  String packet = "{\"nodeId\":\"node-2\",\"battery\":" + String(BATTERY_PERCENT) +
    ",\"sensors\":{\"moisture\":" + String(moisture, 1) + ",\"float\":" + String(waterHigh) + ",\"rain\":" + String(rain, 1);
  if (!isnan(temperature)) packet += ",\"temperature\":" + String(temperature, 1);
  if (!isnan(pressure)) packet += ",\"pressure\":" + String(pressure, 1);
  packet += "}}";
  Serial.println(packet); // Website Connect port button reads this line directly.
}
