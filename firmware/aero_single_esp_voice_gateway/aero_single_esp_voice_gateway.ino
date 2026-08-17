#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>

// Aero-Node one-board demo gateway.
// Phone <-> ESP32 Wi-Fi <-> USB Serial <-> command dashboard.
// No LoRa module, ESP-NOW peer, crypto header or second ESP32 is required.

const char* WIFI_NAME = "AERO-NODE";
const byte DNS_PORT = 53;
WebServer server(80);
DNSServer dnsServer;

const int MAX_MESSAGES = 40;
String messageSender[MAX_MESSAGES];
String messageRecipient[MAX_MESSAGES];
String messageText[MAX_MESSAGES];
int messageCount = 0;
int lastWifiClientCount = -1;
unsigned long lastWifiReportMs = 0;

String jsonEscape(String value) {
  value.replace("\\", "\\\\");
  value.replace("\"", "\\\"");
  value.replace("\n", "\\n");
  value.replace("\r", "");
  return value;
}

String jsonField(const String& json, const String& key) {
  String token = "\"" + key + "\"";
  int keyStart = json.indexOf(token);
  if (keyStart < 0) return "";
  int colon = json.indexOf(':', keyStart + token.length());
  int quote = json.indexOf('\"', colon + 1);
  if (colon < 0 || quote < 0) return "";
  String result;
  bool escaped = false;
  for (int i = quote + 1; i < json.length(); i++) {
    char c = json.charAt(i);
    if (escaped) { result += c == 'n' ? '\n' : c; escaped = false; }
    else if (c == '\\') escaped = true;
    else if (c == '\"') break;
    else result += c;
  }
  return result;
}

void addMessage(const String& sender, const String& recipient, const String& text) {
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

void printPersonPacket(const String& type, const String& userId, const String& name,
                       const String& message, const String& lat, const String& lng,
                       const String& priority) {
  Serial.print("{\"type\":\""); Serial.print(jsonEscape(type));
  Serial.print("\",\"userId\":\""); Serial.print(jsonEscape(userId));
  Serial.print("\",\"name\":\""); Serial.print(jsonEscape(name));
  Serial.print("\",\"nodeId\":\"MASTER\"");
  if (message.length()) { Serial.print(",\"message\":\""); Serial.print(jsonEscape(message)); Serial.print("\""); }
  if (lat.length() && lng.length()) { Serial.print(",\"lat\":"); Serial.print(lat); Serial.print(",\"lng\":"); Serial.print(lng); }
  Serial.print(",\"priority\":\""); Serial.print(jsonEscape(priority)); Serial.println("\"}");
}

void reportWifiClients() {
  unsigned long now = millis();
  int clients = WiFi.softAPgetStationNum();
  if (clients == lastWifiClientCount && now - lastWifiReportMs < 2000) return;
  lastWifiClientCount = clients;
  lastWifiReportMs = now;
  Serial.print("{\"type\":\"telemetry\",\"nodeId\":\"MASTER\",\"label\":\"Single ESP32 Gateway\",\"transport\":\"Wi-Fi + USB Serial\",\"clients\":");
  Serial.print(clients); Serial.println("}");
}

const char RESCUE_PAGE[] PROGMEM = R"rawliteral(
<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#071827"><title>Aero-Node Rescue</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;color:#132238;font-family:Inter,Arial,sans-serif;background:radial-gradient(circle at 8% 0,#b7d3ff,transparent 32%),radial-gradient(circle at 100% 12%,#a4f0df,transparent 30%),linear-gradient(145deg,#f8fbff,#eaf2ff)}button,input,textarea{font:inherit}.shell{max-width:620px;margin:auto;padding:14px 14px 30px}.glass{background:#ffffffd9;border:1px solid #fff;box-shadow:0 22px 60px #3157831f;backdrop-filter:blur(22px)}
.head{position:sticky;z-index:5;top:10px;display:flex;align-items:center;gap:12px;padding:13px;border-radius:20px}.logo{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;color:#fff;background:linear-gradient(145deg,#5685ff,#2858db);box-shadow:0 10px 25px #2f64df47;font-size:20px;font-weight:900}.brand{flex:1}.brand b{display:block;font-size:15px}.brand small{color:#738197;font-size:10px}.online{padding:8px 10px;border-radius:99px;color:#087c68;background:#e2f8f2;font-size:9px;font-weight:800}.hero{padding:30px 5px 19px}.hero>small{color:#3268ec;font-size:9px;font-weight:900;letter-spacing:.16em}.hero h1{margin:9px 0 10px;font-size:38px;line-height:.98;letter-spacing:-2px}.hero p{margin:0;color:#68788e;font-size:12px;line-height:1.55}
.card{margin-bottom:13px;padding:17px;border-radius:22px}.title{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.title b{font-size:14px}.title span{color:#8390a2;font-size:9px}.profile-grid,.compose{display:grid;grid-template-columns:1fr auto;gap:8px}input,textarea{width:100%;padding:13px;border:1px solid #dce5f1;border-radius:13px;outline:0;color:#17233a;background:#f9fbff}textarea{height:66px;resize:none}input:focus,textarea:focus{border-color:#7da0ff;box-shadow:0 0 0 3px #3d6ff514}.primary{border:0;border-radius:13px;color:#fff;background:linear-gradient(145deg,#4778f4,#2e5dd8);font-weight:800}.save,.send{padding:0 17px}.location{width:100%;height:44px;margin-top:9px;border:0;border-radius:13px;color:#087b68;background:#e7f8f3;font-size:11px;font-weight:800}.location.warn{color:#8a6220;background:#fff1dc}.help{display:block;margin:7px 4px 0;color:#7d899b;font-size:9px;line-height:1.45}
#chat{height:260px;overflow:auto;padding:5px}.msg{max-width:84%;margin:10px 0;padding:10px 12px;border-radius:5px 15px 15px;color:#25334a;background:#fff;box-shadow:0 6px 18px #455d8414;font-size:13px;line-height:1.4}.msg.mine{margin-left:auto;border-radius:15px 5px 15px 15px;color:#fff;background:linear-gradient(145deg,#4979f3,#305ed7)}.msg small{display:block;margin-bottom:4px;font-size:8px;opacity:.65}.compose{margin-top:9px}.sos{width:100%;height:45px;margin-top:8px;border:0;border-radius:13px;color:#fff;background:linear-gradient(145deg,#f26472,#db3f50);font-size:11px;font-weight:900}
.voice{overflow:hidden;position:relative;margin-top:11px;padding:14px;border:1px solid #dce7ff;border-radius:17px;background:linear-gradient(145deg,#edf3ff,#f7faff)}.voice-top{display:flex;align-items:center;gap:11px}.mic{display:grid;place-items:center;width:42px;height:42px;border-radius:14px;color:#fff;background:linear-gradient(145deg,#785bff,#4d6ef1);font-size:18px;box-shadow:0 10px 24px #536ae63a}.voice-copy{flex:1}.voice-copy b{display:block;font-size:12px}.voice-copy small{color:#78869b;font-size:9px}.record{width:100%;height:43px;margin-top:11px;border:0;border-radius:12px;color:#415477;background:#fff;box-shadow:inset 0 0 0 1px #dce5f5;font-size:10px;font-weight:850}.record:disabled{opacity:.55}.progress{display:none;margin-top:11px}.progress.show{display:block}.track{height:6px;overflow:hidden;border-radius:9px;background:#dce5f4}.bar{width:0;height:100%;border-radius:9px;background:linear-gradient(90deg,#4c7cf5,#21b99c);transition:width .28s}.state{display:flex;justify-content:space-between;margin-top:6px;color:#65758c;font-size:8px}.note{text-align:center;color:#7c899a;font-size:9px;line-height:1.45;padding:3px 18px 15px}
@media(max-width:440px){.shell{padding:9px 9px 24px}.hero h1{font-size:33px}.online{display:none}.profile-grid{grid-template-columns:1fr}.save{height:42px}}
</style></head><body><main class="shell">
<header class="head glass"><span class="logo">A</span><div class="brand"><b>Aero-Node</b><small>One-board emergency link</small></div><span class="online">● GATEWAY ONLINE</span></header>
<section class="hero"><small>LOCAL RESCUE CHANNEL</small><h1>You are connected.<br>Help can hear you.</h1><p>Share your identity, send a message or attach a short voice note. Keep this page open for replies from rescue command.</p></section>
<section class="card glass"><div class="title"><b>Your rescue identity</b><span id="identity"></span></div><div class="profile-grid"><input id="name" maxlength="32" placeholder="Name or identifying detail"><button class="primary save" onclick="saveProfile()">Save</button></div><button id="locationButton" class="location" onclick="requestLocation()">⌖ Try to share exact GPS</button><small id="locationHelp" class="help">If exact GPS is unavailable, command will place you near this gateway.</small></section>
<section class="card glass"><div class="title"><b>Private command chat</b><span>Direct local link</span></div><div id="chat"></div><div class="compose"><textarea id="message" maxlength="160" placeholder="Describe injuries, surroundings or what you need..."></textarea><button class="primary send" onclick="sendMessage('normal')">Send</button></div><button class="sos" onclick="sendMessage('critical')">SEND CRITICAL SOS</button>
<div class="voice"><div class="voice-top"><span class="mic">●</span><div class="voice-copy"><b>Short voice note</b><small>Up to 5 seconds · converted to rescue voice WAV</small></div></div><input hidden id="voiceFile" type="file" accept="audio/*" capture><button id="recordButton" class="record" onclick="document.getElementById('voiceFile').click()">🎙 Record or choose voice note</button><div id="voiceProgress" class="progress"><div class="track"><div id="voiceBar" class="bar"></div></div><div class="state"><span id="voiceState">Ready</span><span id="voicePercent">0%</span></div></div></div>
</section><p class="note">Demo path: phone Wi-Fi → this ESP32 → USB Serial → command dashboard. No internet is required.</p>
</main><script>
let userId=localStorage.getItem('aeroUserId');if(!userId){userId='USR-'+Math.random().toString(36).slice(2,10).toUpperCase();localStorage.setItem('aeroUserId',userId)}
let survivorName=localStorage.getItem('aeroName')||('Survivor '+userId.slice(-4)),latitude=localStorage.getItem('aeroLat')||'',longitude=localStorage.getItem('aeroLng')||'';
const identity=document.getElementById('identity'),nameInput=document.getElementById('name');identity.textContent=userId;nameInput.value=survivorName;
const wait=ms=>new Promise(r=>setTimeout(r,ms));function post(path,data){return fetch(path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data).toString()})}
function register(){return post('/register',{userId,name:survivorName,lat:latitude,lng:longitude})}function saveProfile(){survivorName=nameInput.value.trim()||survivorName;localStorage.setItem('aeroName',survivorName);register()}
function requestLocation(){const b=document.getElementById('locationButton'),h=document.getElementById('locationHelp');if(!window.isSecureContext||!navigator.geolocation){b.textContent='✓ Using gateway-area location';b.className='location warn';h.textContent='This offline HTTP portal cannot request protected GPS. Command can still place you near the gateway.';register();return}b.textContent='Requesting exact GPS…';navigator.geolocation.getCurrentPosition(p=>{latitude=String(p.coords.latitude);longitude=String(p.coords.longitude);localStorage.setItem('aeroLat',latitude);localStorage.setItem('aeroLng',longitude);b.textContent='✓ Exact GPS shared';h.textContent='Rescue command received your coordinates.';register()},()=>{b.textContent='✓ Using gateway-area location';b.className='location warn';register()},{enableHighAccuracy:true,timeout:10000,maximumAge:30000})}
async function sendMessage(priority){const input=document.getElementById('message'),text=input.value.trim();if(!text&&priority!=='critical')return;const message=text||'Critical SOS — immediate assistance needed';input.value='';await post('/send',{userId,name:survivorName,message,priority,lat:latitude,lng:longitude});loadMessages()}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}let lastJson='';async function loadMessages(){try{const r=await fetch('/messages?userId='+encodeURIComponent(userId)),data=await r.json(),json=JSON.stringify(data);if(json===lastJson)return;lastJson=json;const chat=document.getElementById('chat');chat.innerHTML='';data.forEach(m=>chat.innerHTML+='<div class="msg '+(m.sender==='PHONE'?'mine':'')+'"><small>'+(m.sender==='PHONE'?'YOU':'RESCUE COMMAND')+'</small>'+esc(m.message)+'</div>');chat.scrollTop=chat.scrollHeight}catch(e){}}
function setVoice(state,percent){document.getElementById('voiceProgress').className='progress show';document.getElementById('voiceState').textContent=state;document.getElementById('voicePercent').textContent=percent+'%';document.getElementById('voiceBar').style.width=percent+'%'}
async function encodeVoiceWav(file){const AudioEngine=window.AudioContext||window.webkitAudioContext;if(!AudioEngine)throw new Error('Audio conversion unavailable');const context=new AudioEngine(),source=await context.decodeAudioData(await file.arrayBuffer()),rate=8000,duration=Math.min(source.duration,5),count=Math.max(1,Math.floor(duration*rate)),wav=new Uint8Array(44+count),view=new DataView(wav.buffer);function word(offset,text){for(let i=0;i<text.length;i++)wav[offset+i]=text.charCodeAt(i)}word(0,'RIFF');view.setUint32(4,36+count,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate,true);view.setUint16(32,1,true);view.setUint16(34,8,true);word(36,'data');view.setUint32(40,count,true);const channels=[];for(let c=0;c<source.numberOfChannels;c++)channels.push(source.getChannelData(c));for(let i=0;i<count;i++){const at=Math.min(source.length-1,Math.floor(i*source.sampleRate/rate));let sample=0;for(let c=0;c<channels.length;c++)sample+=channels[c][at];sample=Math.max(-1,Math.min(1,sample/channels.length));wav[44+i]=Math.max(0,Math.min(255,Math.round((sample+1)*127.5)))}await context.close();let binary='';for(let i=0;i<wav.length;i+=8192)binary+=String.fromCharCode.apply(null,wav.subarray(i,i+8192));return{data:btoa(binary),bytes:wav.length,duration}}
document.getElementById('voiceFile').addEventListener('change',async e=>{const file=e.target.files[0],button=document.getElementById('recordButton');if(!file)return;if(!file.size||file.size>4000000){setVoice('Choose a valid short audio recording',0);e.target.value='';return}button.disabled=true;const started=Date.now();try{setVoice('Encoding to 8 kHz rescue voice…',12);const encoded=await encodeVoiceWav(file),data=encoded.data;await wait(900);setVoice('Voice WAV encoded · preparing transfer',28);const chunkSize=480,total=Math.ceil(data.length/chunkSize),voiceId='VOICE-'+Date.now().toString(36).toUpperCase();for(let i=0;i<total;i++){const response=await post('/voice',{voiceId,userId,name:survivorName,mime:'audio/wav',index:String(i),total:String(total),chunk:data.slice(i*chunkSize,(i+1)*chunkSize)});if(!response.ok)throw new Error('Gateway rejected audio chunk');setVoice('Sending through Aero-Node gateway…',28+Math.round((i+1)/total*62))}await post('/voice-complete',{voiceId,userId,name:survivorName,mime:'audio/wav',bytes:String(encoded.bytes),chunks:String(total)});const remaining=5000-(Date.now()-started);if(remaining>0)await wait(remaining);setVoice('✓ Voice note sent to rescue command',100);loadMessages()}catch(error){setVoice('Audio format could not be encoded — try another recording',0)}finally{button.disabled=false;e.target.value=''}});
register();setInterval(loadMessages,900);loadMessages();
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
  String userId = server.arg("userId"), message = server.arg("message"), priority = server.arg("priority");
  message.trim();
  if (!userId.length() || !message.length()) { server.send(400, "text/plain", "Missing message"); return; }
  if (priority != "critical") priority = "normal";
  addMessage("PHONE", userId, message);
  printPersonPacket(priority == "critical" ? "sos" : "message", userId, server.arg("name"), message, server.arg("lat"), server.arg("lng"), priority);
  server.send(200, "text/plain", "OK");
}

void handleVoiceChunk() {
  String voiceId = server.arg("voiceId"), userId = server.arg("userId"), chunk = server.arg("chunk");
  // Base64 never contains spaces. Repair any '+' converted by form decoding.
  chunk.replace(" ", "+");
  int index = server.arg("index").toInt(), total = server.arg("total").toInt();
  if (!voiceId.length() || !userId.length() || !chunk.length() || chunk.length() > 520 || total < 1 || index < 0 || index >= total) {
    server.send(400, "text/plain", "Invalid voice chunk"); return;
  }
  Serial.print("{\"type\":\"voice_chunk\",\"voiceId\":\""); Serial.print(jsonEscape(voiceId));
  Serial.print("\",\"userId\":\""); Serial.print(jsonEscape(userId));
  Serial.print("\",\"name\":\""); Serial.print(jsonEscape(server.arg("name")));
  Serial.print("\",\"nodeId\":\"MASTER\",\"mime\":\""); Serial.print(jsonEscape(server.arg("mime")));
  Serial.print("\",\"index\":"); Serial.print(index); Serial.print(",\"total\":"); Serial.print(total);
  Serial.print(",\"chunk\":\""); Serial.print(chunk); Serial.println("\"}");
  server.send(200, "text/plain", "OK");
}

void handleVoiceComplete() {
  String voiceId = server.arg("voiceId"), userId = server.arg("userId");
  if (!voiceId.length() || !userId.length()) { server.send(400, "text/plain", "Invalid voice completion"); return; }
  addMessage("PHONE", userId, "🎙 Voice note sent");
  Serial.print("{\"type\":\"voice_end\",\"voiceId\":\""); Serial.print(jsonEscape(voiceId));
  Serial.print("\",\"userId\":\""); Serial.print(jsonEscape(userId));
  Serial.print("\",\"name\":\""); Serial.print(jsonEscape(server.arg("name")));
  Serial.print("\",\"nodeId\":\"MASTER\",\"mime\":\""); Serial.print(jsonEscape(server.arg("mime")));
  Serial.print("\",\"bytes\":"); Serial.print(server.arg("bytes"));
  Serial.print(",\"chunks\":"); Serial.print(server.arg("chunks")); Serial.println("}");
  server.send(200, "text/plain", "OK");
}

void handleMessages() {
  String userId = server.arg("userId"), json = "[";
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
    String type = jsonField(line, "type"), recipient = jsonField(line, "to"), message = jsonField(line, "message");
    if (type == "command" && recipient.length() && message.length()) {
      addMessage("MASTER", recipient, message);
      Serial.print("{\"type\":\"sent\",\"to\":\""); Serial.print(jsonEscape(recipient));
      Serial.print("\",\"message\":\""); Serial.print(jsonEscape(message)); Serial.println("\"}");
      return;
    }
  }
  addMessage("MASTER", "BROADCAST", line);
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(50);
  delay(500);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(WIFI_NAME);
  IPAddress apIP = WiFi.softAPIP();
  dnsServer.start(DNS_PORT, "*", apIP);
  server.on("/", HTTP_GET, handleHome);
  server.on("/register", HTTP_POST, handleRegister);
  server.on("/send", HTTP_POST, handleSend);
  server.on("/voice", HTTP_POST, handleVoiceChunk);
  server.on("/voice-complete", HTTP_POST, handleVoiceComplete);
  server.on("/messages", HTTP_GET, handleMessages);
  server.on("/generate_204", HTTP_GET, handleHome);
  server.on("/gen_204", HTTP_GET, handleHome);
  server.on("/hotspot-detect.html", HTTP_GET, handleHome);
  server.on("/connecttest.txt", HTTP_GET, handleHome);
  server.on("/ncsi.txt", HTTP_GET, handleHome);
  server.onNotFound(handleHome);
  server.begin();
  Serial.println("{\"type\":\"gateway\",\"nodeId\":\"MASTER\",\"label\":\"Single ESP32 Gateway\",\"transport\":\"Wi-Fi + USB Serial\",\"status\":\"ready\"}");
  Serial.println("Aero-Node ready at http://192.168.4.1");
}

void loop() {
  dnsServer.processNextRequest();
  server.handleClient();
  reportWifiClients();
  if (Serial.available()) handleSerialCommand(Serial.readStringUntil('\n'));
  delay(2);
}
