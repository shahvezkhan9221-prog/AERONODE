export type Tier = "Normal" | "Watch" | "Warning" | "Critical";
export type Scenario = "idle" | "earthquake" | "flood";
export type Source = "simulation" | "hardware";
export type SensorKey =
  | "acceleration"
  | "shock"
  | "sound"
  | "moisture"
  | "float"
  | "rain"
  | "temperature"
  | "pressure"
  | "pir";
export type Readings = Partial<Record<SensorKey, number | null>>;
export interface Hazard {
  type: string;
  score: number;
  tier: Tier;
  contributors: string[];
  explanation: string;
  total: number;
}
export interface MlDriver {
  feature: string;
  label: string;
  value: string;
  effect: number;
}
export interface MlClassScore {
  id: string;
  label: string;
  probability: number;
  hazard: boolean;
}
export interface MlForecast {
  supported: boolean;
  status: "forecast" | "already-warning" | "unsupported";
  probability: number;
  alert: boolean;
  horizonSeconds: number;
  note: string;
}
/** Advisory model output. The rule engine in fusion.ts still owns every tier and every logged event. */
export interface MlInsight {
  version: string;
  state: string;
  label: string;
  hazard: boolean;
  confidence: number;
  description: string;
  classes: MlClassScore[];
  drivers: MlDriver[];
  forecast: MlForecast;
  agreement: "aligned" | "model-ahead" | "model-calm";
  samples: number;
  window: number;
}
export interface NodeData {
  id: string;
  name: string;
  subtitle: string;
  location: { lat: number; lng: number; name: string };
  battery: number;
  lastSeen: string;
  online: boolean;
  locationSource: "seed" | "gps";
  sensors: Readings;
  hazards: Hazard[];
  ml: MlInsight | null;
  history: { time: number; sensors: Readings; score: number }[];
}
export interface HazardEvent {
  id: string;
  timestamp: string;
  nodeId: string;
  nodeName: string;
  hazard: string;
  tier: Tier;
  score: number;
  contributors: string[];
  explanation: string;
  location: { lat: number; lng: number };
}
export interface Snapshot {
  type: "snapshot";
  source: Source;
  timestamp: string;
  nodes: NodeData[];
  scenario: { name: Scenario; progress: number; running: boolean };
  events: HazardEvent[];
  storageConnected: boolean;
}
export interface TelemetrySample {
  id: string;
  timestamp: string;
  receivedAt: string;
  nodeId: string;
  battery: number;
  sensors: Readings;
  location: { lat: number; lng: number } | null;
  rssi: number | null;
  snr: number | null;
}
export const tierRank: Record<Tier, number> = {
  Normal: 0,
  Watch: 1,
  Warning: 2,
  Critical: 3,
};
export function highestHazard(node: NodeData): Hazard {
  return [...node.hazards].sort(
    (a, b) => tierRank[b.tier] - tierRank[a.tier] || b.score - a.score,
  )[0];
}
export const sensorMeta: Record<
  SensorKey,
  {
    name: string;
    model: string;
    unit: string;
    binary?: boolean;
    context?: boolean;
  }
> = {
  acceleration: { name: "Acceleration", model: "MPU-6050", unit: "g" },
  shock: { name: "Vibration", model: "SW-420", unit: "", binary: true },
  sound: { name: "Acoustic", model: "LM393", unit: "", binary: true },
  moisture: { name: "Soil moisture", model: "FC-28 / YL-69", unit: "%" },
  float: { name: "Water level", model: "Float switch", unit: "", binary: true },
  rain: { name: "Rain pad", model: "MH-RD", unit: "% wetness" },
  temperature: {
    name: "Temperature",
    model: "BMP280",
    unit: "°C",
    context: true,
  },
  pressure: {
    name: "Air pressure",
    model: "BMP280",
    unit: "hPa",
    context: true,
  },
  pir: {
    name: "Presence",
    model: "HC-SR501 · Optional context",
    unit: "",
    binary: true,
    context: true,
  },
};
export function sensorStatus(
  key: SensorKey,
  value: number | null | undefined,
): string {
  if (value == null) return "No data";
  if (key === "pir") return value ? "Detected" : "Clear";
  if (sensorMeta[key].binary) return value ? "Triggered" : "Normal";
  if (key === "temperature" || key === "pressure") return "Context";
  const threshold =
    key === "acceleration" ? 0.15 : key === "moisture" ? 65 : 40;
  return value >= threshold ? "Elevated" : "Normal";
}
