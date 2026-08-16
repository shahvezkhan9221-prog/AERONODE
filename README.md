# Aero-Node Rescue Command

Laptop command surface and ESP32 firmware for the Aero-Node off-grid LoRa rescue mesh. The dashboard uses Web Serial to communicate directly with the master gateway over USB at 115200 baud, manages one private conversation per survivor, and maps nodes and checked-in users with Google Maps.

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

The voice-enabled build uses the two-board architecture from the Aero-Node design:

- Flash [`firmware/aero_node_field_voice.ino`](firmware/aero_node_field_voice.ino) to the **field ESP32** connected to its Ra-02. It creates the open `AERO-NODE` Wi-Fi access point and captive rescue portal at `http://192.168.4.1`.
- Flash [`firmware/aero_node_gateway_voice.ino`](firmware/aero_node_gateway_voice.ino) to the **command ESP32** connected to the laptop and its Ra-02. It forwards LoRa events to the dashboard as newline-delimited JSON over USB at 115200 baud.
- [`firmware/aero_node_master_private_chat_gps.ino`](firmware/aero_node_master_private_chat_gps.ino) remains as the earlier single-board text/GPS prototype; do not flash it when testing the new two-board voice path.

Both radios must use the same LoRa settings: 433 MHz, spreading factor 7, 125 kHz bandwidth, coding rate 4/5 and CRC enabled. The current sketches use these ESP32-to-Ra-02 pins:

| Ra-02 | ESP32 |
| --- | --- |
| NSS / CS | GPIO 5 |
| RESET | GPIO 14 |
| DIO0 | GPIO 26 |
| SCK | GPIO 18 |
| MISO | GPIO 19 |
| MOSI | GPIO 23 |
| VCC | 3.3 V only |
| GND | GND |

Install the ESP32 board package and the **LoRa by Sandeep Mistry** library in Arduino IDE before compiling. Select the correct ESP32 board and USB port for each upload.

### Voice-note path

The phone records through a file/capture control that works on the field node's local HTTP captive portal. Browser JavaScript decodes and resamples the recording, then compresses it with the included `cvsd-4k-v1` prototype codec at 4 kHz (500 bytes per second). The field node accepts at most 8 seconds / 4096 bytes, sends one 180-byte LoRa chunk at a time, and retries each chunk until the gateway acknowledges it. The dashboard verifies the checksum, reconstructs a WAV file in the browser, and displays a player inside that survivor's private conversation.

This is store-and-forward voice, not a live call. An 8-second note may take roughly 15–45 seconds to arrive depending on interference and retries. SOS and text should remain the primary emergency channel. For field-quality speech, replace the prototype codec on both browser/dashboard sides with a tested Codec2 WebAssembly build while keeping the same chunk protocol.

### Flash and test it

1. Disconnect the field board from the laptop, connect the command board, flash `aero_node_gateway_voice.ino`, then leave it attached over USB.
2. Connect the field board separately and flash `aero_node_field_voice.ino`. Power it from its battery after uploading.
3. Keep the two Ra-02 antennas connected before transmitting. Never power an Ra-02 from 5 V.
4. On the laptop, open the deployed dashboard in current Chrome or Edge, choose **Connect ESP32**, and select the command gateway's serial port. Close Arduino Serial Monitor first.
5. On a phone, join the open `AERO-NODE` network. If the captive page does not open automatically, browse to `http://192.168.4.1`.
6. Enter a name, share location if available, and send a text message. It should create a separate survivor conversation on the dashboard.
7. Tap **Record voice note**, record no more than 8 seconds, confirm the recording, and keep the page open until it says the note is queued.
8. Watch **Traffic** on the dashboard for `voice_begin`, `voice_chunk`, and `voice_end`. The playable voice bubble appears after all chunks pass checksum verification.

If voice fails, test with both nodes one metre apart first, confirm matching frequency/settings, inspect both serial monitors separately, and verify that every Ra-02 has a proper 433 MHz antenna and a stable 3.3 V supply.

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

The supplied firmware stores the reply for only that user and forwards a compact targeted command over LoRa.

Incoming voice uses three additional event types. `voice_begin` carries the user and codec metadata, `voice_chunk` carries Base64 payload data, and `voice_end` tells the dashboard to verify and assemble the note. The gateway sketch emits these events automatically; the dashboard does not write voice data back to the ESP32 in this first phase.

## Important deployment notes

- Web Serial requires a secure context: HTTPS in production or `localhost` during development.
- Google Maps requires internet access on the command laptop. Serial communication, private chat and LoRa continue locally if map imagery is unavailable.
- Browser geolocation can fail on desktop Linux even when permission is allowed. The dashboard automatically offers click-to-place mode for the master node.
- Phone geolocation normally requires HTTPS. The HTTP captive portal therefore falls back to a clearly marked approximate node-area position when exact GPS is unavailable.
- LoRa CRC detects corruption; it does not authenticate or encrypt packets. Add application-layer encryption, message authentication, per-node keys, and replay protection before field deployment.
- The ESP access point in the supplied prototype firmware is open. Use device provisioning and a protected rescue workflow before treating the network as production-secure.
- Voice-note data is buffered in ESP32 RAM and browser memory only. Refreshing the dashboard or rebooting a node clears in-progress and received notes.

## Checks

```bash
npm run lint
npm test
```
