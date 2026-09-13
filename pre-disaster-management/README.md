# SENTINEL-MESH

SIH26178 · Disaster Management · explainable environmental early-warning prototype.

## Operator access

Open `/`. Sign in with `operator@sentinel.mesh` / `sentinel2026`, or choose **Enter simulation demo**. Login redirects to `/dashboard`. Authentication is intentionally mock, single-operator demo authentication, not production security.

## Run

The Next.js App Router application uses Supabase Postgres via Drizzle. Copy `.env.example` to `.env.local`, set the Supabase transaction-pooler `DATABASE_URL`, run the SQL in `supabase/migrations/202609120001_realtime_telemetry.sql`, then `npm run dev`. Production: `npm run build`. The platform starts the built application and checks `/api/health`.

### Supabase setup

1. Create a Supabase project and open **Project Settings → Database → Connection string → Transaction pooler**.
2. Put that URI in `DATABASE_URL`. Keep it server-side; never prefix it with `NEXT_PUBLIC_`.
3. In Supabase SQL Editor, run `supabase/migrations/202609120001_realtime_telemetry.sql`.
4. `GATEWAY_TOKEN` is needed only if you use the optional command-line relay instead of the front-page port buttons.

Every valid hardware packet is written immutably to `telemetry_samples`. `hazard_events` receives a row only when the deterministic rule tier changes. Model predictions are intentionally not duplicated: they can be reproduced from the raw samples, and retraining the model must not rewrite historical truth. Row-level security is enabled with no anonymous policies; browser reads go through authenticated server routes. The live UI remains functional if Supabase is temporarily offline and clearly shows that archiving has stopped.

## Structure

- `src/app/page.tsx`: login, no public marketing page
- `src/app/dashboard/page.tsx`: authenticated workspace
- `src/components/dashboard.tsx`: monitoring views, scenarios, evidence drawer
- `src/components/node-card.tsx`: physical sensors, status, live sparklines
- `src/components/network-map.tsx`: Leaflet + OpenStreetMap map (no API key)
- `src/lib/types.ts`: typed telemetry/message contract
- `src/lib/fusion.ts`: single documented source of thresholds and corroboration rules
- `src/lib/ml/features.ts`: temporal feature extraction shared by training and serving
- `src/lib/ml/index.ts`: model inference, driver attribution, forecast gating
- `src/lib/ml/model.ts`: generated weights and held-out metrics (do not edit by hand)
- `src/components/ml-panel.tsx`: model strip, assessment panel, and model card
- `scripts/train-model.ts`: synthetic episode generator and trainer
- `src/lib/monitor.ts`: server-owned source interface, simulator, fusion, ML inference, event logging
- `src/db/schema.ts`: Supabase telemetry and persistent tier-change history
- `src/components/live-telemetry.tsx`: continuous charts and packet-by-packet table
- `src/components/serial-connect.tsx`: two direct Web Serial port controls
- `firmware/`: ready-to-flash USB-direct seismic and flood node sketches
- `scripts/serial-relay.mjs`: optional command-line fallback for browsers without Web Serial

## Realtime architecture

SSE is used instead of a standalone WebSocket server to work natively with the Next.js production runtime. This is an intentional implementation adjustment. Downstream snapshots arrive every 2 seconds through `GET /api/stream`. Upstream controls use `POST /api/control`, and physical packets use authenticated `POST /api/ingest`.

Snapshot schema:

```ts
{
 type: 'snapshot',
 source: 'simulation' | 'hardware',
 timestamp: string, // ISO UTC
 nodes: [{
  id: string, name: string, subtitle: string,
  location: {lat: number, lng: number, name: string},
  battery: number, lastSeen: string, online: boolean,
  sensors: Partial<Record<SensorKey, number | null>>,
  hazards: [{type: string, score: number, tier: 'Normal'|'Watch'|'Warning'|'Critical', contributors: string[], explanation: string, total: number}],
  ml: null | {version: string, state: string, label: string, hazard: boolean, confidence: number, description: string,
   classes: [{id: string, label: string, hazard: boolean, probability: number}],
   drivers: [{feature: string, label: string, value: string, effect: number}],
   forecast: {supported: boolean, status: 'forecast'|'already-warning'|'unsupported', probability: number, alert: boolean, horizonSeconds: number, note: string},
   agreement: 'aligned'|'model-ahead'|'model-calm', samples: number, window: number},
  history: [{time: number, sensors: Readings, score: number}]
 }],
 scenario: {name: 'idle'|'earthquake'|'flood', progress: number, running: boolean},
 events: HazardEvent[], storageConnected: boolean
}
```

Each source implements `DataSource.read(nodeId, progress, scenario)`. Definitions are an array; the UI/map accept N nodes. Current node-specific fusion and validated ingestion support the two built nodes. Adding another physical node requires registering its sensor keys and fusion rules, not rebuilding the UI.

The rolling live buffer stays in process memory for fast charts; every valid hardware packet is also persisted in Supabase for durable trends and future retraining. All connected clients share one simulation. Restarting resets simulation state, while raw telemetry and tier-change history remain. Do not horizontally scale the live simulation process without moving shared state to a broker. History shows up to the latest 500 persisted events plus current-session events; CSV exports the current filter. The new **Live telemetry** view displays the rolling trace and newest-first packet table.

## Hardware connection: two ESP32 boards

1. Flash `firmware/node-01-seismic/node-01-seismic.ino` to the MPU-6500 seismic board and `firmware/node-02-flood/node-02-flood.ino` to the flood board. Install **TinyGPSPlus**, **Adafruit BMP280**, **Adafruit Unified Sensor**, and **Adafruit BusIO**. The MPU-6500 sketch uses direct I²C registers and needs no MPU library. Calibrate the dry/wet ADC constants before trusting percentages.
2. Connect both ESP32 boards to the laptop with data-capable USB cables and close Arduino Serial Monitor.
3. Open the dashboard in desktop Chrome or Edge on `http://localhost:3000`. Web Serial requires localhost or HTTPS.
4. On Overview, click **Connect port** for Node 01 and select its ESP32. Repeat for Node 02. The browser asks for each port explicitly; Linux device permissions are not bypassed.
5. The dashboard automatically switches to Hardware mode. Readings older than 12 seconds mark that node offline, with no simulated fallback.

Both sketches emit exactly one normalized JSON object per line at 115200 baud. GPIO 18 can remain the Node 01 GPS TX pin because LoRa SPI is not used in the two-board USB-direct architecture. In receive-only GPS wiring, only NEO-6M TX → ESP32 GPIO 16 is required.

If Web Serial is unavailable, run `scripts/serial-relay.mjs` once for each port in two terminals. Configure the same `GATEWAY_TOKEN` on the server and both processes; use a different `SERIAL_PORT` for each process.

Node 1 packet:

```json
{
  "nodeId": "node-1",
  "battery": 86,
  "sensors": { "acceleration": 0.025, "shock": 0, "sound": 0 },
  "location": { "lat": 27.6058, "lng": 77.5934 }
}
```

Node 2 packet:

```json
{
  "nodeId": "node-2",
  "battery": 92,
  "sensors": {
    "moisture": 38,
    "float": 0,
    "rain": 8,
    "temperature": 29.4,
    "pressure": 1008.6
  }
}
```

The browser stamps receipt time as ISO UTC before forwarding each line. Direct ingestion requires a timestamp within 60 seconds of the server clock. Node 01 requires acceleration/shock/sound; Node 02 requires moisture/float/rain, while BMP280 temperature/pressure and PIR are optional context. `null` denotes no data. Binary signals accept only 0 or 1. Moisture/rain are 0–100%; acceleration is gravity-removed peak deviation in g (0–32). Optional location uses decimal degrees. Seeded GLA University (Mathura) positions are replaced by a valid Node 01 GPS fix.

## Explainable fusion: the alert authority

Thresholds are demo-calibrated evidence rules, not validated probability estimates or confirmed disaster detections. The implementation and detailed comments live in `src/lib/fusion.ts`.

| Hazard  | Normal                 | Watch                               | Warning                       | Critical                                   |
| ------- | ---------------------- | ----------------------------------- | ----------------------------- | ------------------------------------------ |
| Seismic | no votes: 8%           | 1 vote: 35%                         | any 2: 68%; 3 below peak: 78% | all 3 AND ≥0.60 g: 92%                     |
| Flood   | float clear + dry: 12% | float alone or rain ≥40% alone: 36% | float AND rain ≥40%: 72%      | float AND rain ≥75% AND moisture ≥85%: 94% |

Fusion owns every tier, every colour on the dashboard, and every row in the event history. The trained model described below is advisory and cannot change any of them.

Seismic votes: MPU-6050 deviation ≥0.15 g, SW-420 shock trip, LM393 sound comparator. PIR is never read by the fusion module. Missing readings contribute no evidence. Rain pad wetness is not rainfall in mm/h. No individual sensor can generate Warning/Critical. Flood corroboration from rain/soil is environmental context, **not** a redundant direct water-level measurement.

## Trained model layer

A trained model runs beside the rules on every tick, on the same readings, for both the simulator and live USB packets. It is **advisory**: it cannot raise, lower or suppress a tier, and it writes nothing to the event history. Open **Model insight** in the sidebar, or the _Model assessment_ section of any node drawer.

It exists because a threshold reads one instant, and so cannot express two things an operator needs:

- **What the pattern is.** Repeated SW-420 and LM393 trips from a passing truck satisfy the two-signal seismic rule. The model reads the 20-sample (30 s) trajectory instead of the instant, sees comparator chatter with no acceleration envelope, and calls it _Machinery or traffic_. It does the same for a knocked enclosure, for soil wetting under a dry rain pad, and for a float switch jammed high over dry ground.
- **How close the rules are to firing.** A second head estimates the probability that `fuse()` reaches Warning within the next 30 seconds.

### How it is built

|               |                                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Algorithm     | Standardised softmax regression (state) + logistic regression (early warning), Adam, L2                                                                    |
| Input         | 20 samples per node, 30 s of trajectory                                                                                                                    |
| Features      | per sensor: last, mean, peak, variability, trend, time above threshold; per binary sensor: duty cycle and re-trigger rate; plus cross-sensor co-activation |
| Artefact      | `src/lib/ml/model.ts`, 9 KB of weights. No runtime dependency, no network call, microseconds per node                                                      |
| Training data | 1,300 seeded synthetic episodes, 104,341 labelled windows                                                                                                  |
| Split         | by episode, 75/25, so overlapping windows cannot leak across the split                                                                                     |

PIR is never read by the feature extractor, exactly as it is never read by `fuse()`. With fewer than four valid readings in the window the model abstains instead of guessing, and an offline node gets no prediction at all.

Retrain with `npm run train`. The script regenerates `src/lib/ml/model.ts` and prints the metrics below.

### Held-out synthetic metrics

**Training data is synthetic.** No real earthquake or flood telemetry was available for this prototype. Episodes come from the seeded generator in `scripts/train-model.ts`: ramped onsets, sensor noise, per-episode calibration offsets, packet dropout, and deliberate nuisance events. **These numbers describe the model on synthetic data. They are not evidence of real-world detection skill.**

| Node    | State                | Precision | Recall | Support |
| ------- | -------------------- | --------- | ------ | ------- |
| Node 01 | Baseline             | 97.8%     | 97.6%  | 13,170  |
|         | Seismic event        | 97.5%     | 97.5%  | 2,486   |
|         | Machinery or traffic | 88.3%     | 92.6%  | 2,221   |
|         | Node disturbance     | 97.1%     | 89.7%  | 1,093   |
| Node 02 | Baseline             | 91.3%     | 96.5%  | 7,026   |
|         | Flooding             | 99.1%     | 95.8%  | 4,148   |
|         | Local wetting        | 99.2%     | 97.2%  | 3,393   |
|         | Passing shower       | 90.7%     | 85.2%  | 3,240   |
|         | Float switch fault   | 99.9%     | 100.0% | 5,982   |

Node 01: 96.6% accuracy, macro F1 0.95 over 18,970 held-out windows. Node 02: 95.8% accuracy, macro F1 0.95 over 23,789.

The early-warning head is shown only where its held-out AUC clears 0.75.

- **Node 02, shown.** AUC 0.971, precision 69.3%, recall 81.0% at a 0.80 operating point chosen on the training split. Median **24 s** of lead over the rule engine on held-out episodes.
- **Node 01, hidden.** AUC 0.657, below the bar, so the UI states plainly that this node has no forecast. A single co-located accelerometer cannot see ground motion before it arrives; real earthquake early warning needs distant stations. On Node 01 the model earns its place by nuisance rejection instead.

### What this layer does not do

- It is not trained on real disaster data, so its probabilities are not calibrated hazard probabilities.
- It does not replace corroboration. Warnings still require two independent physical signals from `fuse()`.
- It adds no sensor. A stuck float is flagged as a likely fault, but there is still only one direct water-level sensor.
- It is not a life-safety system and issues no official warning.

## Demo flow

Choose **Run simulation** or **Demo studio**, select a scenario, and start. Values ramp over 45 seconds; tiers change as independent thresholds become active. Peak values hold so judges can inspect evidence. Use **Reset to baseline** to clear the scenario. Alert notifications are local visual UI notifications, not SMS/sirens or official warnings.

## Honest hardware caveats

- Float switch is the only direct water-level sensor; no ultrasonic backup.
- FC-28 / YL-69 resistive probe corrodes during long deployments; short-demo use only.
- LM393 is a binary comparator, not calibrated analog acoustics.
- PIR / HC-SR501 is context only and contributes zero hazard evidence.
- No sustained tilt/displacement sensing exists.
- Neither node is enclosed or weatherproofed; both are exposed-air prototypes.
- ESP32 WROOM-32 nodes use TP4056 + 18650 batteries.
- Not for life-safety decisions or official public disaster warnings.

## Tests

```sh
npm test
```

Runs both suites. `npm run test:fusion` covers the tier thresholds, all individual sensor extremes, PIR invariance, missing data, and all binary corroboration combinations. `npm run test:ml` covers abstention on thin data, PIR invariance, determinism, each trained state including the nuisance states, forecast gating, and the invariant that inference never alters a rule output.
