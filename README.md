# AERONODE

AERONODE is a two-part disaster-management platform covering the full incident lifecycle: **early awareness before a disaster** and **rescue coordination after one**. Each application is self-contained, with its own dashboard, firmware, dependencies, setup guide, and tests.

> These are hackathon prototypes for situational awareness and demonstration. They are not certified life-safety systems and must not be used as official public-warning or emergency-dispatch infrastructure.

## Projects

| Project | Phase | Purpose | Hardware connection |
| --- | --- | --- | --- |
| [SENTINEL-MESH](pre-disaster-management/) | Pre-disaster | Continuous earthquake and flood sensing, explainable multi-sensor alerts, advisory ML predictions, live trends, and Supabase history | Two sensor ESP32 boards connected directly to two laptop USB ports |
| [Aero-Node Rescue Command](post-disaster-management/) | Post-disaster | Survivor check-ins, private and group communication, voice-note transfer, mapping, and experimental resilient radio networking | One ESP32 rescue gateway for the main demo; optional multi-node experiments |

## Repository structure

```text
AERONODE/
├── pre-disaster-management/     # SENTINEL-MESH early-warning dashboard
│   ├── firmware/                # Earthquake and flood ESP32 sketches
│   ├── src/                     # Next.js application and prediction engine
│   ├── supabase/                # Telemetry/event database migration
│   └── README.md                # Complete setup and sensor protocol
└── post-disaster-management/    # Existing Aero-Node rescue application
    ├── app/                     # Command dashboard
    ├── firmware/                # Rescue gateway and network experiments
    ├── worker/                  # Hosted application runtime
    └── README.md                # Complete rescue-demo setup
```

## Pre-disaster system

The pre-disaster application reads two ESP32 boards through browser-approved serial ports at 115200 baud:

- **Node 01 — seismic:** MPU-6500, SW-420, LM393 sound comparator, and NEO-6M GPS.
- **Node 02 — flood:** soil-moisture probe, rain pad, float switch, and BMP280 environmental context.

The dashboard requires corroboration from independent physical signals before raising Warning or Critical. A trained temporal model runs beside the rules to classify patterns and forecast supported flood escalation, but it cannot modify an alert tier. Valid hardware packets are archived in Supabase; rule-tier changes are stored separately as explainable hazard events.

### Run the pre-disaster dashboard

```bash
cd pre-disaster-management
npm install
npm run dev
```

Open `http://localhost:3000`, enter the dashboard, and use the two **Connect port** buttons on Overview. Use desktop Chrome or Edge, connect both ESP32 boards with data-capable USB cables, and close Arduino Serial Monitor before selecting the ports.

See the [SENTINEL-MESH setup guide](pre-disaster-management/README.md) for firmware libraries, wiring notes, Supabase configuration, packet validation, thresholds, model limitations, and tests.

## Post-disaster system

The post-disaster application is the original Aero-Node Rescue Command project. Its primary demonstration uses one USB-connected ESP32 that creates a local `AERO-NODE` phone access point and bridges survivor check-ins, private/group messages, and MP3 voice notes to the laptop dashboard. The folder also preserves the existing encrypted LoRa and ESP-NOW experiments.

### Run the post-disaster dashboard

```bash
cd post-disaster-management
npm install
npm run dev
```

See the [Aero-Node Rescue Command guide](post-disaster-management/README.md) for the one-board demo, firmware, Google Maps configuration, encrypted networking experiments, and serial protocol.

## Development checks

Run checks from the application you changed:

```bash
cd pre-disaster-management
npm run typecheck
npm test
npm run build
```

```bash
cd post-disaster-management
npm run lint
npm test
npm run build
```

Environment files, generated network secrets, build output, and dependencies are ignored repository-wide. Never commit database passwords, Google Maps keys, gateway tokens, or generated radio keys.
