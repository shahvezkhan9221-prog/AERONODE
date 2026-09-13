#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <SPI.h>
#include <LoRa.h>
#include <esp_now.h>
#include <esp_idf_version.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "aero_network_secrets.h"
#include "AeroCrypto.h"

// Aero-Node master gateway: per-phone identity, private chats and GPS packets.
// ESP32 AP address: http://192.168.4.1

const char* WIFI_NAME = "AERO-NODE";
const byte DNS_PORT = 53;
WebServer server(80);
DNSServer dnsServer;

#define LORA_SS 5
#define LORA_RST 14
#define LORA_DIO0 26
#define LORA_SCK 18
#define LORA_MISO 19
#define LORA_MOSI 23
#define LORA_FREQ 433E6

const uint8_t WIFI_CHANNEL = 6;
const size_t ESPNOW_MAX_FRAME_BYTES = 250;
const uint8_t ESPNOW_BROADCAST[6] = { 0xff, 0xff, 0xff, 0xff, 0xff, 0xff };

struct EspNowRxFrame {
  uint8_t sender[6];
  uint8_t length;
  uint8_t data[ESPNOW_MAX_FRAME_BYTES];
};

QueueHandle_t espNowRxQueue = nullptr;

AeroCrypto radioCrypto(AERO_NETWORK_KEY, AERO_NODE_ID);
void addMessage(String sender, String recipient, String text);

const int MAX_MESSAGES = 40;
String messageSender[MAX_MESSAGES];
String messageRecipient[MAX_MESSAGES];
String messageText[MAX_MESSAGES];
int messageCount = 0;

int lastWifiClientCount = -1;
unsigned long lastWifiReportMs = 0;
const unsigned long WIFI_REPORT_INTERVAL_MS = 2000;

String jsonEscape(String value) {
  value.replace("\\", "\\\\");
  value.replace("\"", "\\\"");
  value.replace("\n", "\\n");
  value.replace("\r", "");
  return value;
}

bool sendEncryptedRadio(const String& plaintext) {
  uint8_t frame[255];
  size_t frameLength = 0;
  if (!radioCrypto.encrypt(
        reinterpret_cast<const uint8_t*>(plaintext.c_str()), plaintext.length(),
        frame, sizeof(frame), frameLength)) {
    Serial.println("{\"type\":\"error\",\"message\":\"Encrypted LoRa packet is too large or crypto is unavailable\"}");
    return false;
  }
  LoRa.beginPacket();
  LoRa.write(frame, frameLength);
  bool loraQueued = LoRa.endPacket() == 1;
  bool espNowQueued = frameLength <= ESPNOW_MAX_FRAME_BYTES &&
    esp_now_send(ESPNOW_BROADCAST, frame, frameLength) == ESP_OK;
  return loraQueued || espNowQueued;
}

void queueEspNowFrame(const uint8_t* sender, const uint8_t* data, int length) {
  if (!espNowRxQueue || !sender || !data || length < 1 || length > static_cast<int>(ESPNOW_MAX_FRAME_BYTES)) return;
  EspNowRxFrame frame = {};
  memcpy(frame.sender, sender, sizeof(frame.sender));
  frame.length = static_cast<uint8_t>(length);
  memcpy(frame.data, data, length);
  xQueueSend(espNowRxQueue, &frame, 0);
}

#if ESP_IDF_VERSION_MAJOR >= 5
void onEspNowReceive(const esp_now_recv_info_t* info, const uint8_t* data, int length) {
  queueEspNowFrame(info ? info->src_addr : nullptr, data, length);
}
#else
void onEspNowReceive(const uint8_t* sender, const uint8_t* data, int length) {
  queueEspNowFrame(sender, data, length);
}
#endif

bool beginEspNow() {
  espNowRxQueue = xQueueCreate(8, sizeof(EspNowRxFrame));
  if (!espNowRxQueue || esp_now_init() != ESP_OK) return false;
  if (esp_now_register_recv_cb(onEspNowReceive) != ESP_OK) return false;
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, ESPNOW_BROADCAST, sizeof(peer.peer_addr));
  peer.channel = WIFI_CHANNEL;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false; // Broadcast cannot use ESP-NOW LMK; AeroCrypto protects the payload.
  return esp_now_add_peer(&peer) == ESP_OK || esp_now_is_peer_exist(ESPNOW_BROADCAST);
}

void processEncryptedNetworkFrame(const uint8_t* frame, size_t frameLength, const char* transport) {
  uint8_t plaintext[AeroCrypto::kMaxPlaintextBytes + 1];
  size_t plaintextLength = 0;
  AeroDecryptResult result = radioCrypto.decrypt(frame, frameLength, plaintext, sizeof(plaintext), plaintextLength);
  if (result == AeroDecryptResult::Ok) {
    String message = reinterpret_cast<const char*>(plaintext);
    Serial.print("{\"type\":\"network\",\"transport\":\""); Serial.print(transport);
    Serial.print("\",\"authenticated\":true,\"bytes\":"); Serial.print(frameLength); Serial.println("}");
    if (message.startsWith("{")) Serial.println(message);
    else { addMessage("RELAY", "BROADCAST", message); Serial.print("RELAY: "); Serial.println(message); }
  } else if (result == AeroDecryptResult::AuthenticationFailed) {
    Serial.print("{\"type\":\"error\",\"message\":\"Rejected "); Serial.print(transport); Serial.println(" packet: authentication failed\"}");
  } else if (result != AeroDecryptResult::ReplayRejected) {
    Serial.print("{\"type\":\"error\",\"message\":\"Rejected invalid encrypted "); Serial.print(transport); Serial.println(" packet\"}");
  }
}

void processEspNowQueue() {
  if (!espNowRxQueue) return;
  EspNowRxFrame frame;
  while (xQueueReceive(espNowRxQueue, &frame, 0) == pdTRUE) {
    processEncryptedNetworkFrame(frame.data, frame.length, "ESP-NOW");
  }
}

String jsonField(const String& json, const String& key) {
  String token = "\"" + key + "\"";
  int keyStart = json.indexOf(token);
  if (keyStart < 0) return "";
  int colon = json.indexOf(':', keyStart + token.length());
  if (colon < 0) return "";
  int quote = json.indexOf('\"', colon + 1);
  if (quote < 0) return "";
  String result = "";
  bool escaped = false;
  for (int i = quote + 1; i < json.length(); i++) {
    char c = json.charAt(i);
    if (escaped) {
      if (c == 'n') result += '\n'; else result += c;
      escaped = false;
    } else if (c == '\\') {
      escaped = true;
    } else if (c == '\"') {
      break;
    } else {
      result += c;
    }
  }
  return result;
}

void addMessage(String sender, String recipient, String text) {
  if (messageCount >= MAX_MESSAGES) {
    for (int i = 0; i < MAX_MESSAGES - 1; i++) {
      messageSender[i] = messageSender[i + 1];
      messageRecipient[i] = messageRecipient[i + 1];
      messageText[i] = messageText[i + 1];
    }
    messageCount = MAX_MESSAGES - 1;
  }
  messageSender[messageCount] = sender;
  messageRecipient[messageCount] = recipient;
  messageText[messageCount] = text;
  messageCount++;
}

void printPersonPacket(String type, String userId, String name, String message, String lat, String lng, String priority) {
  Serial.print("{\"type\":\""); Serial.print(jsonEscape(type));
  Serial.print("\",\"userId\":\""); Serial.print(jsonEscape(userId));
  Serial.print("\",\"name\":\""); Serial.print(jsonEscape(name));
  Serial.print("\",\"nodeId\":\"MASTER\"");
  if (message.length()) { Serial.print(",\"message\":\""); Serial.print(jsonEscape(message)); Serial.print("\""); }
  if (lat.length() && lng.length()) { Serial.print(",\"lat\":"); Serial.print(lat); Serial.print(",\"lng\":"); Serial.print(lng); }
  if (priority.length()) { Serial.print(",\"priority\":\""); Serial.print(jsonEscape(priority)); Serial.print("\""); }
  Serial.println("}");
}

void reportWifiClients() {
  unsigned long now = millis();
  int clients = WiFi.softAPgetStationNum();
  if (clients == lastWifiClientCount && now - lastWifiReportMs < WIFI_REPORT_INTERVAL_MS) return;
  lastWifiClientCount = clients;
  lastWifiReportMs = now;
  Serial.print("{\"type\":\"telemetry\",\"nodeId\":\"MASTER\",\"label\":\"Laptop Gateway\",\"encryption\":\"AES-256-GCM\",\"transport\":\"LoRa + ESP-NOW\",\"secure\":true,\"clients\":");
  Serial.print(clients);
  Serial.println("}");
}

const char RESCUE_PAGE[] PROGMEM = R"rawliteral(
<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aero-Node Rescue</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;color:#14213a;font-family:Arial,sans-serif;background:radial-gradient(circle at 5% 2%,#a9c7ff,transparent 34%),radial-gradient(circle at 92% 8%,#a7ecdf,transparent 31%),linear-gradient(145deg,#f8fbff,#eaf2ff)}
.shell{max-width:620px;margin:auto;padding:16px}.glass{background:#ffffffc9;border:1px solid #fff;box-shadow:0 18px 50px #47659420;backdrop-filter:blur(20px)}
.head{border-radius:22px;padding:17px;display:flex;align-items:center;gap:12px}.logo{width:42px;height:42px;border-radius:14px;background:linear-gradient(145deg,#5482ff,#2e5bd6);color:#fff;display:grid;place-items:center;font-weight:900;font-size:21px}.head div:nth-child(2){flex:1}.head b{font-size:16px}.head small{display:block;color:#718096;margin-top:3px}.online{font-size:11px;color:#07836d;background:#e2f8f2;padding:8px 10px;border-radius:99px}
.hero{padding:28px 5px 18px}.hero small{color:#3268ec;font-weight:800;letter-spacing:.14em}.hero h1{font-size:34px;letter-spacing:-1.5px;line-height:1.02;margin:8px 0}.hero p{color:#69788e;font-size:13px;line-height:1.5;margin:0}.profile,.chat{border-radius:22px;padding:17px;margin-bottom:14px}.title{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.title b{font-size:15px}.title span{font-size:10px;color:#718096}
input,textarea{width:100%;border:1px solid #dce5f1;background:#f9fbff;border-radius:13px;padding:13px;outline:0;font:inherit;color:#17233a}input:focus,textarea:focus{border-color:#7da0ff;box-shadow:0 0 0 3px #3d6ff514}.profile-grid{display:grid;grid-template-columns:1fr auto;gap:8px}.profile button,.send{border:0;border-radius:13px;background:#3169ef;color:#fff;padding:0 16px;font-weight:700}.location{margin-top:9px;width:100%;height:44px;border:0;border-radius:13px;background:#e7f8f3;color:#087b68;font-weight:750}.location.warn{background:#fff1dc;color:#8a6220}.location-help{display:block;color:#7d899b;font-size:10px;line-height:1.4;margin:7px 4px 0}
#chat{height:330px;overflow:auto;padding:5px}.msg{max-width:82%;padding:10px 12px;border-radius:15px;background:#fff;box-shadow:0 6px 18px #455d8414;margin:10px 0;font-size:14px;line-height:1.4}.msg.mine{margin-left:auto;background:linear-gradient(145deg,#4979f3,#305ed7);color:#fff}.msg small{display:block;font-size:9px;opacity:.65;margin-bottom:4px}.compose{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:10px}.compose textarea{height:66px;resize:none}.send{min-width:84px}.sos{width:100%;height:46px;border:0;border-radius:13px;background:#ed5361;color:#fff;font-weight:800;margin-top:8px}.note{text-align:center;color:#7c899a;font-size:10px;line-height:1.45;padding:2px 18px 18px}
@media(max-width:440px){.shell{padding:10px}.hero h1{font-size:29px}.online{display:none}.profile-grid{grid-template-columns:1fr}.profile button{height:42px}}
</style></head><body><main class="shell">
<header class="head glass"><span class="logo">A</span><div><b>Aero-Node</b><small>Emergency rescue link</small></div><span class="online">● MASTER ONLINE</span></header>
<section class="hero"><small>OFF-GRID SURVIVAL NETWORK</small><h1>You are connected.<br>Help can hear you.</h1><p>Share your name and location, then keep this page open to message the rescue command privately.</p></section>
<section class="profile glass"><div class="title"><b>Your rescue identity</b><span id="identity"></span></div><div class="profile-grid"><input id="name" maxlength="32" placeholder="Your name or identifying detail"><button onclick="saveProfile()">Save</button></div><button id="locationButton" class="location" onclick="requestLocation()">⌖ Try to share exact GPS</button><small id="locationHelp" class="location-help">You are already mapped near this Aero-Node. Exact GPS is added only when your browser permits it.</small></section>
<section class="chat glass"><div class="title"><b>Private command chat</b><span>Only your conversation</span></div><div id="chat"></div><div class="compose"><textarea id="message" maxlength="160" placeholder="Describe your condition, injuries or surroundings..."></textarea><button class="send" onclick="sendMessage('normal')">Send</button></div><button class="sos" onclick="sendMessage('critical')">Send critical SOS</button></section>
  <p class="note">Stay connected to AERO-NODE. Internet is not required. The LoRa radio hop is encrypted and authenticated with AES-256-GCM; this local emergency Wi-Fi portal remains an open HTTP network.</p>
</main><script>
let userId=localStorage.getItem('aeroUserId');if(!userId){userId='USR-'+Math.random().toString(36).slice(2,10).toUpperCase();localStorage.setItem('aeroUserId',userId)}
let survivorName=localStorage.getItem('aeroName')||('Survivor '+userId.slice(-4));let latitude=localStorage.getItem('aeroLat')||'';let longitude=localStorage.getItem('aeroLng')||'';
document.getElementById('identity').textContent=userId;document.getElementById('name').value=survivorName;
function post(path,data){return fetch(path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data).toString()})}
function register(){post('/register',{userId:userId,name:survivorName,lat:latitude,lng:longitude})}
function saveProfile(){survivorName=document.getElementById('name').value.trim()||survivorName;localStorage.setItem('aeroName',survivorName);register()}
function requestLocation(){const b=document.getElementById('locationButton'),h=document.getElementById('locationHelp');if(!window.isSecureContext){b.textContent='✓ Using Aero-Node area location';b.className='location warn';h.textContent='Exact phone GPS is protected by your browser because this offline portal uses HTTP. Rescue command can still see your approximate node-area position.';register();return}if(!navigator.geolocation){b.textContent='✓ Using Aero-Node area location';b.className='location warn';register();return}b.textContent='Requesting exact GPS…';navigator.geolocation.getCurrentPosition(p=>{latitude=String(p.coords.latitude);longitude=String(p.coords.longitude);localStorage.setItem('aeroLat',latitude);localStorage.setItem('aeroLng',longitude);b.textContent='✓ Exact GPS shared';b.className='location';h.textContent='Rescue command received your phone coordinates.';register()},e=>{b.textContent='✓ Using Aero-Node area location';b.className='location warn';h.textContent='Location permission was not available. Rescue command can still see your approximate node-area position.';register()},{enableHighAccuracy:true,timeout:12000,maximumAge:30000})}
async function sendMessage(priority){const input=document.getElementById('message');const text=input.value.trim();if(!text&&priority!=='critical')return;const message=text||(priority==='critical'?'Critical SOS — immediate assistance needed':'');input.value='';await post('/send',{userId:userId,name:survivorName,message:message,priority:priority,lat:latitude,lng:longitude});loadMessages()}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}let lastJson='';async function loadMessages(){try{const r=await fetch('/messages?userId='+encodeURIComponent(userId));const data=await r.json();const json=JSON.stringify(data);if(json===lastJson)return;lastJson=json;const chat=document.getElementById('chat');chat.innerHTML='';data.forEach(m=>{chat.innerHTML+='<div class="msg '+(m.sender==='PHONE'?'mine':'')+'"><small>'+(m.sender==='PHONE'?'YOU':'RESCUE COMMAND')+'</small>'+esc(m.message)+'</div>'});chat.scrollTop=chat.scrollHeight}catch(e){}}
register();setInterval(loadMessages,800);loadMessages();
</script></body></html>
)rawliteral";

void handleHome() { server.send_P(200, "text/html", RESCUE_PAGE); }

void handleRegister() {
  String userId = server.arg("userId");
  if (!userId.length()) { server.send(400, "text/plain", "Missing userId"); return; }
  printPersonPacket("user", userId, server.arg("name"), "", server.arg("lat"), server.arg("lng"), "normal");
  server.send(200, "text/plain", "OK");
}

void handleSend() {
  String userId = server.arg("userId");
  String name = server.arg("name");
  String message = server.arg("message");
  String priority = server.arg("priority");
  message.trim();
  if (!userId.length() || !message.length()) { server.send(400, "text/plain", "Missing message"); return; }
  if (priority != "critical") priority = "normal";
  String radioPayload = "USER|" + userId + "|" + name + "|" + message;
  if (!sendEncryptedRadio(radioPayload)) { server.send(503, "text/plain", "Secure radio send failed"); return; }
  addMessage("PHONE", userId, message);
  printPersonPacket(priority == "critical" ? "sos" : "message", userId, name, message, server.arg("lat"), server.arg("lng"), priority);
  server.send(200, "text/plain", "OK");
}

void handleMessages() {
  String userId = server.arg("userId");
  String json = "[";
  bool first = true;
  for (int i = 0; i < messageCount; i++) {
    if (messageRecipient[i] != userId && messageRecipient[i] != "BROADCAST") continue;
    if (!first) json += ",";
    first = false;
    json += "{\"sender\":\"" + jsonEscape(messageSender[i]) + "\",\"message\":\"" + jsonEscape(messageText[i]) + "\"}";
  }
  json += "]";
  server.send(200, "application/json", json);
}

void handleSerialCommand(String line) {
  line.trim();
  if (!line.length()) return;
  if (line.startsWith("{")) {
    String type = jsonField(line, "type");
    String recipient = jsonField(line, "to");
    String message = jsonField(line, "message");
    if (type == "command" && recipient.length() && message.length()) {
      if (!sendEncryptedRadio("CMD|" + recipient + "|" + message)) return;
      addMessage("MASTER", recipient, message);
      Serial.print("{\"type\":\"sent\",\"to\":\""); Serial.print(jsonEscape(recipient)); Serial.print("\",\"message\":\""); Serial.print(jsonEscape(message)); Serial.println("\"}");
      return;
    }
  }
  if (!sendEncryptedRadio("MASTER:" + line)) return;
  addMessage("MASTER", "BROADCAST", line);
}

void setup() {
  Serial.begin(115200);
  delay(600);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(WIFI_NAME, nullptr, WIFI_CHANNEL);
  IPAddress apIP = WiFi.softAPIP();
  dnsServer.start(DNS_PORT, "*", apIP);

  if (!radioCrypto.begin()) {
    Serial.println("CRYPTO START FAILED: generate aero_network_secrets.h and use a unique non-zero node ID");
    while (true) delay(1000);
  }
  if (!beginEspNow()) {
    Serial.println("ESP-NOW START FAILED");
    while (true) delay(1000);
  }

  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println("LoRa START FAILED");
    while (true) delay(1000);
  }
  LoRa.setTxPower(17);
  LoRa.setSpreadingFactor(7);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  LoRa.enableCrc();

  server.on("/", HTTP_GET, handleHome);
  server.on("/register", HTTP_POST, handleRegister);
  server.on("/send", HTTP_POST, handleSend);
  server.on("/messages", HTTP_GET, handleMessages);
  server.on("/generate_204", HTTP_GET, handleHome);
  server.on("/gen_204", HTTP_GET, handleHome);
  server.on("/hotspot-detect.html", HTTP_GET, handleHome);
  server.on("/connecttest.txt", HTTP_GET, handleHome);
  server.on("/ncsi.txt", HTTP_GET, handleHome);
  server.onNotFound(handleHome);
  server.begin();
  Serial.println("Aero-Node ready at http://192.168.4.1");
  Serial.println("{\"type\":\"security\",\"encryption\":\"AES-256-GCM\",\"transport\":\"LoRa + ESP-NOW\",\"secure\":true}");
}

void loop() {
  dnsServer.processNextRequest();
  server.handleClient();
  reportWifiClients();
  processEspNowQueue();

  int packetSize = LoRa.parsePacket();
  if (packetSize) {
    uint8_t frame[255];
    size_t frameLength = 0;
    while (LoRa.available() && frameLength < sizeof(frame)) frame[frameLength++] = LoRa.read();
    processEncryptedNetworkFrame(frame, frameLength, "LoRa");
  }

  if (Serial.available()) handleSerialCommand(Serial.readStringUntil('\n'));
}
