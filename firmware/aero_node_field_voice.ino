#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <SPI.h>
#include <LoRa.h>

// Aero-Node FIELD unit: captive rescue portal + reliable store-and-forward voice.
// Prototype voice codec: adaptive 1-bit CVSD, 4 kHz, 500 bytes/second.

const char* WIFI_NAME = "AERO-NODE";
const char* NODE_ID = "FIELD-01";
WebServer server(80);
DNSServer dnsServer;
const byte DNS_PORT = 53;

#define LORA_SS 5
#define LORA_RST 14
#define LORA_DIO0 26
#define LORA_SCK 18
#define LORA_MISO 19
#define LORA_MOSI 23
#define LORA_FREQ 433E6

const uint8_t VOICE_MAGIC = 0xA7;
const uint8_t VOICE_VERSION = 1;
const uint8_t VOICE_BEGIN = 0x30;
const uint8_t VOICE_DATA = 0x31;
const uint8_t VOICE_ACK = 0x32;
const uint8_t VOICE_END = 0x33;
const uint16_t VOICE_BEGIN_SEQUENCE = 0xFFFF;
const uint16_t VOICE_END_SEQUENCE = 0xFFFE;
const size_t VOICE_CHUNK_BYTES = 180;
const size_t MAX_VOICE_BYTES = 4096; // 8.192 seconds at 4 kHz CVSD
const unsigned long ACK_TIMEOUT_MS = 1200;
const uint8_t MAX_RETRIES = 4;

struct VoiceJob {
  bool active;
  uint32_t messageId;
  String userId;
  String name;
  uint32_t sampleCount;
  uint32_t totalBytes;
  uint32_t checksum;
  uint16_t chunkCount;
  uint16_t nextChunk;
  uint16_t waitingSequence;
  uint8_t phase; // 0 begin, 1 chunks, 2 end
  uint8_t retries;
  bool waitingAck;
  unsigned long sentAt;
};

VoiceJob voice = {};
uint8_t voiceBytes[MAX_VOICE_BYTES];
size_t uploadLength = 0;
bool uploadFailed = false;
unsigned long lastHeartbeatAt = 0;

String jsonEscape(String value) {
  value.replace("\\", "\\\\");
  value.replace("\"", "\\\"");
  value.replace("\n", "\\n");
  value.replace("\r", "");
  return value;
}

String safeField(String value) {
  value.replace("|", "/");
  value.replace("\n", " ");
  value.replace("\r", " ");
  return value;
}

uint32_t fnv1a32(const uint8_t* data, size_t length) {
  uint32_t hash = 0x811c9dc5;
  for (size_t i = 0; i < length; i++) {
    hash ^= data[i];
    hash *= 0x01000193;
  }
  return hash;
}

void write16(uint8_t* output, uint16_t value) {
  output[0] = value & 0xFF;
  output[1] = (value >> 8) & 0xFF;
}

void write32(uint8_t* output, uint32_t value) {
  output[0] = value & 0xFF;
  output[1] = (value >> 8) & 0xFF;
  output[2] = (value >> 16) & 0xFF;
  output[3] = (value >> 24) & 0xFF;
}

uint16_t read16(const uint8_t* input) {
  return uint16_t(input[0]) | (uint16_t(input[1]) << 8);
}

uint32_t read32(const uint8_t* input) {
  return uint32_t(input[0]) | (uint32_t(input[1]) << 8) |
         (uint32_t(input[2]) << 16) | (uint32_t(input[3]) << 24);
}

void sendVoiceFrame(uint8_t type, uint16_t sequence, const uint8_t* payload, uint8_t payloadLength) {
  uint8_t header[12];
  header[0] = VOICE_MAGIC;
  header[1] = VOICE_VERSION;
  header[2] = type;
  write32(header + 3, voice.messageId);
  write16(header + 7, sequence);
  write16(header + 9, voice.chunkCount);
  header[11] = payloadLength;
  LoRa.beginPacket();
  LoRa.write(header, sizeof(header));
  if (payloadLength) LoRa.write(payload, payloadLength);
  LoRa.endPacket();
  voice.waitingSequence = sequence;
  voice.waitingAck = true;
  voice.sentAt = millis();
  Serial.printf("VOICE TX id=%08lX seq=%u phase=%u retry=%u\n",
                (unsigned long)voice.messageId, sequence, voice.phase, voice.retries);
}

void transmitCurrentVoiceFrame() {
  if (!voice.active) return;
  if (voice.phase == 0) {
    String metadata = safeField(voice.userId) + "|" + safeField(voice.name) + "|" +
      String(voice.sampleCount) + "|" + String(voice.totalBytes) + "|" +
      String(voice.checksum) + "|cvsd-4k-v1";
    sendVoiceFrame(VOICE_BEGIN, VOICE_BEGIN_SEQUENCE,
      reinterpret_cast<const uint8_t*>(metadata.c_str()), metadata.length());
  } else if (voice.phase == 1) {
    size_t offset = size_t(voice.nextChunk) * VOICE_CHUNK_BYTES;
    size_t remaining = voice.totalBytes - offset;
    uint8_t count = min(remaining, VOICE_CHUNK_BYTES);
    sendVoiceFrame(VOICE_DATA, voice.nextChunk, voiceBytes + offset, count);
  } else {
    sendVoiceFrame(VOICE_END, VOICE_END_SEQUENCE, nullptr, 0);
  }
}

void finishVoice(bool success) {
  Serial.printf("VOICE %s id=%08lX\n", success ? "COMPLETE" : "FAILED", (unsigned long)voice.messageId);
  voice = {};
  uploadLength = 0;
}

void acceptAck(uint32_t messageId, uint16_t sequence) {
  if (!voice.active || !voice.waitingAck || voice.messageId != messageId || voice.waitingSequence != sequence) return;
  voice.waitingAck = false;
  voice.retries = 0;
  if (voice.phase == 0) {
    voice.phase = 1;
    voice.nextChunk = 0;
  } else if (voice.phase == 1) {
    voice.nextChunk++;
    if (voice.nextChunk >= voice.chunkCount) voice.phase = 2;
  } else {
    finishVoice(true);
  }
}

void serviceVoice() {
  if (!voice.active) return;
  if (!voice.waitingAck) {
    transmitCurrentVoiceFrame();
    return;
  }
  if (millis() - voice.sentAt < ACK_TIMEOUT_MS) return;
  if (++voice.retries > MAX_RETRIES) {
    finishVoice(false);
    return;
  }
  voice.waitingAck = false;
}

void sendTextPacket(String userId, String name, String priority, String lat, String lng, String message) {
  String packet = "USER|" + safeField(userId) + "|" + safeField(name) + "|" +
    safeField(priority) + "|" + safeField(lat) + "|" + safeField(lng) + "|" + safeField(message);
  LoRa.beginPacket();
  LoRa.print(packet);
  LoRa.endPacket();
  Serial.println("TEXT TX " + packet);
}

void serviceHeartbeat() {
  if (voice.active || millis() - lastHeartbeatAt < 10000) return;
  lastHeartbeatAt = millis();
  LoRa.beginPacket();
  LoRa.print("NODE|"); LoRa.print(NODE_ID); LoRa.print('|'); LoRa.print(WiFi.softAPgetStationNum());
  LoRa.endPacket();
}

const char PORTAL_PAGE[] PROGMEM = R"HTML(
<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aero-Node Rescue</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:20px;color:#14223a;background:radial-gradient(circle at 10% 10%,#d9e7ff,transparent 45%),radial-gradient(circle at 90% 25%,#c9fff1,transparent 42%),#eef4fb;font-family:Arial,sans-serif}.shell{max-width:520px;margin:auto}.brand,.card{border:1px solid #fff;background:rgba(255,255,255,.78);box-shadow:0 22px 60px rgba(40,68,105,.14);backdrop-filter:blur(18px)}.brand{display:flex;align-items:center;padding:16px;border-radius:22px}.logo{display:grid;place-items:center;width:46px;height:46px;border-radius:15px;color:#fff;background:linear-gradient(145deg,#4f7cff,#2457d6);font-size:23px;font-weight:900}.brand div{margin-left:12px}.brand b{display:block}.brand small{color:#6d7c92}.hero{padding:28px 6px 16px}.hero small{color:#2d6bf0;font-weight:800;letter-spacing:.14em}.hero h1{margin:8px 0;font-size:34px;line-height:1}.hero p{color:#687991;line-height:1.5}.card{margin-top:12px;padding:20px;border-radius:24px}.field{margin-bottom:13px}.field label{display:block;margin:0 0 6px;color:#52647d;font-size:11px;font-weight:800}.field input,.field textarea{width:100%;padding:14px;border:1px solid #dce5f0;border-radius:13px;outline:0;background:#f9fbfe;font-size:15px}.field textarea{min-height:100px;resize:vertical}.row{display:grid;grid-template-columns:1fr 1fr;gap:9px}button{width:100%;min-height:48px;border:0;border-radius:14px;color:#fff;background:linear-gradient(145deg,#527fff,#2e60dc);font-weight:800}.secondary{color:#216b5d;background:#dcf8f0}.critical{background:linear-gradient(145deg,#f35d68,#c62f40)}#voiceStatus,#locationStatus{display:block;margin-top:9px;color:#718097;font-size:11px;line-height:1.4}.ok{color:#0a8d6e!important}.warn{color:#ad6a17!important}.messages{max-height:210px;overflow:auto}.message{margin:8px 0;padding:11px 13px;border-radius:13px;background:#f0f4fa;font-size:13px}.message.master{margin-left:22px;color:#fff;background:#3169ef}.message small{display:block;margin-bottom:4px;opacity:.65}input[type=file]{display:none}.badge{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border-radius:99px;color:#087b68;background:#dff8f1;font-size:10px;font-weight:800}.badge:before{content:'';width:7px;height:7px;border-radius:50%;background:#15b58c}
</style></head><body><main class="shell"><header class="brand"><span class="logo">A</span><div><b>Aero-Node Rescue</b><small>Off-grid emergency link</small></div></header><section class="hero"><small>FIELD NODE ONLINE</small><h1>You are connected.</h1><p>Share your location, send a message or record a short voice note. Keep this page open.</p><span class="badge">LoRa link ready</span></section><section class="card"><div class="field"><label>Your name</label><input id="name" maxlength="28" placeholder="Name or description"></div><button class="secondary" onclick="shareLocation()">Share my location</button><small id="locationStatus">Location has not been shared yet.</small></section><section class="card"><div class="field"><label>Emergency message</label><textarea id="message" maxlength="180" placeholder="Tell rescuers what happened and what you need"></textarea></div><div class="row"><button onclick="sendText(false)">Send update</button><button class="critical" onclick="sendText(true)">Send SOS</button></div></section><section class="card"><div class="field"><label>Voice note · maximum 8 seconds</label><button onclick="document.getElementById('voiceFile').click()">Record voice note</button><input id="voiceFile" type="file" accept="audio/*" capture></div><small id="voiceStatus">Voice is compressed before it crosses LoRa. Sending takes longer than recording.</small></section><section class="card"><b>Private conversation</b><div id="messages" class="messages"></div></section></main><script>
const SAMPLE_RATE=4000,MAX_SAMPLES=32000;let lat='',lng='';const id=localStorage.aeroUserId||(localStorage.aeroUserId='USR-'+Math.random().toString(36).slice(2,10).toUpperCase());document.getElementById('name').value=localStorage.aeroName||'';
function status(el,text,cls=''){el.textContent=text;el.className=cls}function form(values){return Object.entries(values).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&')}function user(){const name=document.getElementById('name').value.trim()||'Unknown survivor';localStorage.aeroName=name;return name}
function shareLocation(){const out=document.getElementById('locationStatus');if(!navigator.geolocation){status(out,'Location is unavailable. You can still send an SOS.','warn');return}status(out,'Requesting phone location…');navigator.geolocation.getCurrentPosition(p=>{lat=p.coords.latitude.toFixed(6);lng=p.coords.longitude.toFixed(6);status(out,'Location shared: '+lat+', '+lng,'ok');checkIn()},e=>status(out,'Location was not shared ('+e.message+'). Messages still work.','warn'),{enableHighAccuracy:true,timeout:15000,maximumAge:30000})}
async function checkIn(){await fetch('/register',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form({userId:id,name:user(),lat,lng})})}
async function sendText(sos){const box=document.getElementById('message'),text=box.value.trim();if(!text)return;const r=await fetch('/send',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form({userId:id,name:user(),lat,lng,priority:sos?'critical':'normal',message:text})});if(r.ok){box.value='';loadMessages()}}
function fnv(bytes){let h=0x811c9dc5;for(const b of bytes){h^=b;h=Math.imul(h,0x01000193)>>>0}return h>>>0}
function encode(samples){const out=new Uint8Array(Math.ceil(samples.length/8));let predictor=0,step=.02,last=-1,run=0;for(let i=0;i<samples.length;i++){const bit=samples[i]>=predictor?1:0;if(bit)out[i>>3]|=1<<(7-(i&7));predictor=Math.max(-1,Math.min(1,predictor+(bit?step:-step)));if(bit===last)run++;else run=1;step=run>=3?Math.min(.25,step*1.12):Math.max(.002,step*.97);last=bit}return out}
async function makeVoice(file){const ctx=new (window.AudioContext||window.webkitAudioContext)(),decoded=await ctx.decodeAudioData(await file.arrayBuffer()),count=Math.min(MAX_SAMPLES,Math.floor(decoded.duration*SAMPLE_RATE)),mono=new Float32Array(count);for(let i=0;i<count;i++){const source=Math.min(decoded.length-1,Math.floor(i*decoded.sampleRate/SAMPLE_RATE));let value=0;for(let c=0;c<decoded.numberOfChannels;c++)value+=decoded.getChannelData(c)[source];mono[i]=value/decoded.numberOfChannels}await ctx.close();let peak=.01;for(const v of mono)peak=Math.max(peak,Math.abs(v));const gain=Math.min(4,.9/peak);for(let i=0;i<mono.length;i++)mono[i]*=gain;return{bytes:encode(mono),samples:count}}
document.getElementById('voiceFile').addEventListener('change',async e=>{const file=e.target.files[0],out=document.getElementById('voiceStatus');if(!file)return;try{status(out,'Compressing voice note…');const note=await makeVoice(file);if(note.samples<800)throw Error('Recording is too short');const body=new FormData();body.append('voice',new Blob([note.bytes]),'voice.cvsd');const query=new URLSearchParams({userId:id,name:user(),sampleCount:String(note.samples),checksum:String(fnv(note.bytes)),codec:'cvsd-4k-v1'});status(out,'Uploading '+(note.samples/SAMPLE_RATE).toFixed(1)+' second note to the field node…');const r=await fetch('/voice?'+query,{method:'POST',body});if(!r.ok)throw Error(await r.text());status(out,'Voice note queued for LoRa delivery. Keep this page open.','ok');loadMessages()}catch(err){status(out,'Voice note failed: '+err.message,'warn')}finally{e.target.value=''}});
async function loadMessages(){try{const data=await(await fetch('/messages?userId='+encodeURIComponent(id))).json(),box=document.getElementById('messages');box.innerHTML=data.map(m=>'<div class="message '+(m.sender==='MASTER'?'master':'')+'"><small>'+m.sender+'</small>'+m.message.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</div>').join('');box.scrollTop=box.scrollHeight}catch{}}setInterval(loadMessages,1500);checkIn();loadMessages();
</script></body></html>)HTML";

String messageSenders[24];
String messageTexts[24];
String messageTargets[24];
int messageCount = 0;

void rememberMessage(String target, String sender, String text) {
  if (messageCount == 24) {
    for (int i = 0; i < 23; i++) { messageTargets[i] = messageTargets[i + 1]; messageSenders[i] = messageSenders[i + 1]; messageTexts[i] = messageTexts[i + 1]; }
    messageCount = 23;
  }
  messageTargets[messageCount] = target;
  messageSenders[messageCount] = sender;
  messageTexts[messageCount++] = text;
}

void handleHome() { server.send_P(200, "text/html", PORTAL_PAGE); }

void handleRegister() {
  sendTextPacket(server.arg("userId"), server.arg("name"), "normal", server.arg("lat"), server.arg("lng"), "");
  server.send(200, "application/json", "{\"ok\":true}");
}

void handleSend() {
  String text = server.arg("message"); text.trim();
  if (!text.length()) { server.send(400, "text/plain", "Message is empty"); return; }
  sendTextPacket(server.arg("userId"), server.arg("name"), server.arg("priority"), server.arg("lat"), server.arg("lng"), text);
  rememberMessage(server.arg("userId"), "YOU", text);
  server.send(200, "application/json", "{\"ok\":true}");
}

void handleVoiceUpload() {
  HTTPUpload& upload = server.upload();
  if (upload.status == UPLOAD_FILE_START) { uploadLength = 0; uploadFailed = voice.active; }
  else if (upload.status == UPLOAD_FILE_WRITE && !uploadFailed) {
    if (uploadLength + upload.currentSize > MAX_VOICE_BYTES) uploadFailed = true;
    else { memcpy(voiceBytes + uploadLength, upload.buf, upload.currentSize); uploadLength += upload.currentSize; }
  } else if (upload.status == UPLOAD_FILE_ABORTED) uploadFailed = true;
}

void handleVoiceComplete() {
  uint32_t samples = strtoul(server.arg("sampleCount").c_str(), nullptr, 10);
  uint32_t expected = strtoul(server.arg("checksum").c_str(), nullptr, 10);
  if (uploadFailed || voice.active) { server.send(409, "text/plain", "Another voice note is transmitting"); return; }
  if (!uploadLength || uploadLength > MAX_VOICE_BYTES || samples < 800 || samples > 32000 || fnv1a32(voiceBytes, uploadLength) != expected) {
    uploadLength = 0; server.send(400, "text/plain", "Invalid voice payload"); return;
  }
  voice.active = true;
  voice.messageId = esp_random();
  voice.userId = server.arg("userId");
  voice.name = server.arg("name");
  voice.sampleCount = samples;
  voice.totalBytes = uploadLength;
  voice.checksum = expected;
  voice.chunkCount = (uploadLength + VOICE_CHUNK_BYTES - 1) / VOICE_CHUNK_BYTES;
  rememberMessage(voice.userId, "YOU", "Voice note queued · " + String(samples / 4000.0, 1) + " sec");
  server.send(202, "application/json", "{\"ok\":true,\"messageId\":\"" + String(voice.messageId, HEX) + "\"}");
}

void handleMessages() {
  String target = server.arg("userId");
  String json = "[";
  bool first = true;
  for (int i = 0; i < messageCount; i++) {
    if (messageTargets[i] != target) continue;
    if (!first) json += ',';
    first = false;
    json += "{\"sender\":\"" + jsonEscape(messageSenders[i]) + "\",\"message\":\"" + jsonEscape(messageTexts[i]) + "\"}";
  }
  server.send(200, "application/json", json + "]");
}

void handleLoRaReceive() {
  int packetSize = LoRa.parsePacket();
  if (!packetSize) return;
  uint8_t packet[255];
  size_t length = 0;
  while (LoRa.available() && length < sizeof(packet)) packet[length++] = LoRa.read();
  if (length >= 12 && packet[0] == VOICE_MAGIC && packet[1] == VOICE_VERSION && packet[2] == VOICE_ACK) {
    acceptAck(read32(packet + 3), read16(packet + 7));
    return;
  }
  String text;
  for (size_t i = 0; i < length; i++) text += char(packet[i]);
  if (text.startsWith("CMD|")) {
    int first = text.indexOf('|', 4);
    if (first > 0) {
      String target = text.substring(4, first);
      String body = text.substring(first + 1);
      rememberMessage(target, "MASTER", body);
    }
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(WIFI_NAME);
  IPAddress apIP = WiFi.softAPIP();
  dnsServer.start(DNS_PORT, "*", apIP);
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) { Serial.println("LoRa start failed"); while (true) delay(1000); }
  LoRa.setTxPower(17); LoRa.setSpreadingFactor(7); LoRa.setSignalBandwidth(125E3); LoRa.setCodingRate4(5); LoRa.enableCrc();
  server.on("/", HTTP_GET, handleHome);
  server.on("/register", HTTP_POST, handleRegister);
  server.on("/send", HTTP_POST, handleSend);
  server.on("/messages", HTTP_GET, handleMessages);
  server.on("/voice", HTTP_POST, handleVoiceComplete, handleVoiceUpload);
  server.on("/generate_204", HTTP_GET, handleHome); server.on("/gen_204", HTTP_GET, handleHome);
  server.on("/hotspot-detect.html", HTTP_GET, handleHome); server.on("/connecttest.txt", HTTP_GET, handleHome);
  server.onNotFound(handleHome);
  server.begin();
  Serial.printf("Aero-Node field ready: %s at %s\n", WIFI_NAME, apIP.toString().c_str());
}

void loop() {
  dnsServer.processNextRequest();
  server.handleClient();
  handleLoRaReceive();
  serviceVoice();
  serviceHeartbeat();
}
