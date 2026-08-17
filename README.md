# Aero-Node Rescue Command

Laptop command surface and ESP32 firmware for the Aero-Node rescue-network prototype. The active hackathon demo uses one ESP32 as a phone Wi-Fi access point and USB Serial bridge. The dashboard manages one private conversation per survivor, receives playable short voice notes, and maps checked-in users with Google Maps. Experimental LoRa and ESP-NOW firmware remains in the repository for later multi-node work.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in current Chrome or Edge, select **Connect ESP32**, and choose the ESP32 USB serial port. Close Arduino Serial Monitor first because only one application can own the port.

Create `.dev.vars` for Google Maps when running locally:

```bash
GOOGLE_MAPS_API_KEY=your_restricted_browser_key
```

Enable the Google Maps JavaScript API and restrict the key to the deployed website. The key is intentionally not stored in this repository.

## ESP32 firmware

For the current one-board demo, flash [`firmware/aero_single_esp_voice_gateway/aero_single_esp_voice_gateway.ino`](firmware/aero_single_esp_voice_gateway/aero_single_esp_voice_gateway.ino). It needs only the ESP32 Arduino core—no Ra-02, ESP-NOW peer, encryption header or second board. It creates the `AERO-NODE` access point and rescue portal at `http://192.168.4.1`, assigns each phone a persistent user ID, reports check-ins and messages as JSON over Serial, and delivers command replies only to the addressed user.

The phone portal accepts short audio recordings or audio files up to 45 KB. It displays a minimum five-second encoding and transfer sequence, sends the real Base64 audio in 480-character chunks through the ESP32 and USB Serial, and the command dashboard displays receiving and decoding states before creating a playable audio message. This is a local one-board demonstration path, not a LoRa voice transfer.

### One-board demo

1. Select an ESP32 Dev Module in Arduino IDE and open the one-board `.ino` file.
2. Flash it without adding any extra project header files.
3. Keep the ESP32 attached to the command laptop over USB.
4. On a phone, join the open `AERO-NODE` Wi-Fi and open `http://192.168.4.1` if the portal does not appear automatically.
5. In Chrome or Edge on the laptop, open the command dashboard, click **Connect ESP32**, and select the board at 115200 baud.
6. Send text, SOS, or a short voice note from the phone. Voice notes appear in that survivor's individual conversation.

The sections below describe the optional multi-device experiments and are not required for the one-board demo.

## LoRa encryption and decryption

The radio hop uses **AES-256-GCM authenticated encryption** through the Mbed TLS implementation included with the ESP32 Arduino core. Encryption hides the LoRa payload. The 128-bit GCM authentication tag makes altered packets fail decryption instead of being accepted as rescue data.

Each encrypted frame contains:

```text
AN | version | flags | unique node ID | persistent packet counter |
ciphertext length | ciphertext | 128-bit authentication tag
```

The unique node ID plus persistent 64-bit counter forms the 96-bit GCM nonce. Each boot reserves one million counters in ESP32 NVS, preventing normal reboots from repeating a nonce. The receiver tracks the highest counter seen from recent nodes and rejects duplicates during that boot. The unencrypted header is authenticated as GCM additional authenticated data, so changing its sender, counter or length also invalidates the packet.

### Generate and install keys

From the project directory, run this once:

```bash
node tools/generate-aero-secrets.mjs
```

It creates four ignored files containing the same random 256-bit key and different random node IDs:

- `firmware/aero_network_secrets.h` for the master sketch.
- `firmware/secure_peer_example/aero_network_secrets.h` for the matching peer sketch.
- `firmware/espnow_field_node/aero_network_secrets.h` for the ESP-NOW field node.
- `firmware/espnow_relay_node/aero_network_secrets.h` for the ESP-NOW relay.

These secret files are excluded by `.gitignore`. Never paste the key into the dashboard, Serial Monitor, screenshots or GitHub. For another field node, copy a generated secret header so it keeps the same key, then assign that device a new unique non-zero `AERO_NODE_ID`.

Flash the master sketch and [`firmware/secure_peer_example/secure_peer_example.ino`](firmware/secure_peer_example/secure_peer_example.ino) to two ESP32/Ra-02 devices for a bench test. Both radios must use the same frequency and LoRa settings. Text entered into the peer Serial Monitor is encrypted before transmission; the master decrypts it only after its authentication tag and replay counter pass validation.

## Hybrid ESP-NOW + LoRa network

ESP-NOW is the nearby ESP32-to-ESP32 layer; LoRa remains the long-range backbone. The master transmits the same AES-256-GCM envelope over both transports. Whichever copy arrives first is accepted, and the other is rejected by the replay counter as a duplicate.

```text
Phone -> field ESP32 -> ESP-NOW relay(s) -> hybrid gateway -> USB dashboard
                           |                    ^
                           +------ LoRa --------+
```

All ESP-NOW devices use Wi-Fi channel 6. The master uses `WIFI_AP_STA`, so it can keep the phone captive portal active while receiving ESP-NOW packets. Broadcast ESP-NOW frames are protected by the application AES-256-GCM envelope because ESP-NOW's LMK encryption does not support multicast/broadcast.

Use these sketches:

- [`firmware/espnow_field_node/espnow_field_node.ino`](firmware/espnow_field_node/espnow_field_node.ino): sends an encrypted SOS when GPIO 27 is pressed, accepts a text message from Serial, and emits a real heartbeat.
- [`firmware/espnow_relay_node/espnow_relay_node.ino`](firmware/espnow_relay_node/espnow_relay_node.ino): authenticates each new frame and broadcasts it once. Duplicate/replayed frames are dropped, preventing an endless relay loop.
- [`firmware/aero_node_master_private_chat_gps.ino`](firmware/aero_node_master_private_chat_gps.ino): receives encrypted ESP-NOW and LoRa copies, decrypts the first valid copy, and sends the resulting JSON to the dashboard.

This is a controlled flooding relay for a hackathon prototype, not a complete routing protocol. ESP-NOW operates on Wi-Fi radio and does not automatically become long range or self-healing. Add packet acknowledgements, hop limits, route scoring and store-and-forward queues before calling it a production mesh.

### Hybrid demo setup

1. Generate the secret headers with `node tools/generate-aero-secrets.mjs`.
2. Flash the hybrid master sketch and leave it connected to the command laptop.
3. Flash the relay sketch to a second ESP32 and power it between the field node and gateway.
4. Flash the field-node sketch to a third ESP32. Connect a push button between GPIO 27 and GND.
5. Open Serial Monitor at 115200 on the field node and type a message, or press the button for an SOS.
6. Open the dashboard Traffic view. It reports whether the authenticated packet arrived over `ESP-NOW` or `LoRa`.
7. Move the field node out of direct ESP-NOW reach while keeping the relay between it and the master. Repeat the SOS to demonstrate the relay path.

If you erase the ESP32 flash/NVS, rotate the network key before sending again because the persistent transmit counter also resets. For a production deployment, use per-node keys or a proper provisioning system, store keys in protected hardware, and persist receiver replay state. A shared network key means one captured node can expose the rest of that mesh.

AES-GCM is standardized by [NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final). The implementation calls `mbedtls_gcm_crypt_and_tag()` for encryption and `mbedtls_gcm_auth_decrypt()` for authenticated decryption.

## Serial protocol

The dashboard accepts newline-delimited JSON. A field node can transmit an SOS packet through LoRa, and the master can print the packet unchanged with `Serial.println(message)`:

```json
{"type":"sos","nodeId":"AN-02","userId":"SUR-218","name":"Unknown survivor","lat":23.0227,"lng":72.5743,"message":"Two people trapped","priority":"critical","battery":34,"rssi":-91}
```

Master or field-node heartbeat/telemetry:

```json
{"type":"telemetry","nodeId":"MASTER","label":"Laptop Gateway","clients":2}
```

The dashboard also accepts legacy `PHONE:` and `RELAY:` lines. Legacy messages without GPS are mapped approximately around the master node.

Replies are written back to USB as one JSON line:

```json
{"type":"command","to":"USR-ABC12345","message":"Rescue team is en route."}
```

The supplied firmware stores the reply for only that user and forwards a compact targeted command inside the authenticated encrypted LoRa envelope. The dashboard receives plaintext JSON only after the ESP32 gateway has successfully decrypted and authenticated the radio packet.

## Important deployment notes

- Web Serial requires a secure context: HTTPS in production or `localhost` during development.
- Google Maps requires internet access on the command laptop. Serial communication, private chat and LoRa continue locally if map imagery is unavailable.
- Browser geolocation can fail on desktop Linux even when permission is allowed. The dashboard automatically offers click-to-place mode for the master node.
- Phone geolocation normally requires HTTPS. The HTTP captive portal therefore falls back to a clearly marked approximate node-area position when exact GPS is unavailable.
- LoRa CRC still detects accidental radio corruption. AES-256-GCM adds confidentiality and cryptographic authentication at the application layer, while the packet counter provides prototype replay protection.
- The AES-256-GCM application envelope covers both LoRa and ESP-NOW device-to-device packets. The ESP access point and survivor phone-to-captive-portal hop remain open HTTP so an unknown survivor can connect without a password. Nearby Wi-Fi users could observe that local hop; use WPA2/provisioning or an end-to-end application protocol when that threat matters.
- The live dashboard is public by design. It keeps received data only in the current browser session, but anyone with physical access to the command laptop or its open dashboard can view that session.

## Checks

```bash
npm run lint
npm test
```
