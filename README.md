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

Flash [`firmware/aero_node_master_private_chat_gps.ino`](firmware/aero_node_master_private_chat_gps.ino) to the ESP32 master gateway. It creates the `AERO-NODE` access point and rescue portal at `http://192.168.4.1`, assigns each phone a persistent user ID, reports check-ins and messages as JSON over Serial, and delivers command replies only to the addressed user.

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

## Important deployment notes

- Web Serial requires a secure context: HTTPS in production or `localhost` during development.
- Google Maps requires internet access on the command laptop. Serial communication, private chat and LoRa continue locally if map imagery is unavailable.
- Browser geolocation can fail on desktop Linux even when permission is allowed. The dashboard automatically offers click-to-place mode for the master node.
- Phone geolocation normally requires HTTPS. The HTTP captive portal therefore falls back to a clearly marked approximate node-area position when exact GPS is unavailable.
- LoRa CRC detects corruption; it does not authenticate or encrypt packets. Add application-layer encryption, message authentication, per-node keys, and replay protection before field deployment.
- The ESP access point in the supplied prototype firmware is open. Use device provisioning and a protected rescue workflow before treating the network as production-secure.

## Checks

```bash
npm run lint
npm test
```
