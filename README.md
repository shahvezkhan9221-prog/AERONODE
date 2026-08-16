# Aero-Node Rescue Command

Laptop command surface for the Aero-Node off-grid LoRa rescue mesh. It uses the browser's Web Serial API to communicate directly with the ESP32 gateway over USB at 115200 baud—no separate Node.js bridge is required for the prototype.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in current Chrome or Edge, select **Connect ESP32**, and choose the ESP32 USB serial port. Close Arduino Serial Monitor first because only one application can own the port.

## Serial protocol

The dashboard accepts newline-delimited JSON. A field node can transmit an SOS packet through LoRa, and the master can print the packet unchanged with `Serial.println(message)`:

```json
{"type":"sos","nodeId":"AN-02","userId":"SUR-218","name":"Unknown survivor","lat":23.0227,"lng":72.5743,"message":"Two people trapped","priority":"critical","battery":34,"rssi":-91}
```

Node heartbeat/telemetry:

```json
{"type":"telemetry","nodeId":"AN-02","label":"Market Sector","lat":23.0219,"lng":72.5752,"battery":64,"rssi":-91,"people":5}
```

The dashboard also accepts the current test firmware's `PHONE:` and `RELAY:` lines. Those legacy messages have no GPS data, so they are placed at the relaying node's position.

Replies are written back to USB as one JSON line:

```json
{"type":"reply","to":"SUR-218","nodeId":"AN-02","message":"Rescue team is en route.","ts":1786860000000}
```

Your current master firmware already forwards that line over LoRa with its `MASTER:` prefix. The field firmware should remove the prefix, parse the JSON, and deliver the message to the intended local user.

## Important deployment notes

- Web Serial requires a secure context: HTTPS in production or `localhost` during development.
- The visible map uses OpenStreetMap tiles. Markers still function without tiles, but a fully off-grid deployment should run a local tile server or package offline tiles.
- LoRa CRC detects corruption; it does not authenticate or encrypt packets. Add application-layer encryption, message authentication, per-node keys, and replay protection before field deployment.
- The ESP access point in the supplied prototype firmware is open. Use device provisioning and a protected rescue workflow before treating the network as production-secure.

## Checks

```bash
npm run lint
npm test
```
