"use client";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  BatteryMedium,
  ChevronDown,
  Clock3,
  Cloud,
  Database,
  Gauge,
  Radio,
} from "lucide-react";
import { NodeData, SensorKey, sensorMeta, sensorStatus } from "@/lib/types";
import { Badge } from "./node-card";
import { highestHazard } from "@/lib/types";

function display(key: SensorKey, value: number | null | undefined) {
  const meta = sensorMeta[key];
  if (value == null) return "—";
  if (meta.binary) return value ? "ACTIVE" : "CLEAR";
  return `${value.toFixed(key === "acceleration" ? 3 : 1)} ${meta.unit}`;
}

const sensorGuide: Partial<Record<SensorKey, { threshold: number; label: string }>> = {
  acceleration: { threshold: 0.15, label: "Watch threshold · 0.15 g" },
  shock: { threshold: 0.5, label: "Trigger boundary" },
  sound: { threshold: 0.5, label: "Trigger boundary" },
  moisture: { threshold: 65, label: "Elevated soil moisture · 65%" },
  float: { threshold: 0.5, label: "Water contact boundary" },
  rain: { threshold: 40, label: "Wetness threshold · 40%" },
};

function summaryValue(key: SensorKey, value: number, kind: "average" | "range") {
  if (sensorMeta[key].binary) return kind === "average" ? `${Math.round(value * 100)}% active` : value ? "Triggered" : "Clear";
  return `${value.toFixed(key === "acceleration" ? 3 : 1)} ${sensorMeta[key].unit}`;
}

export default function LiveTelemetry({
  nodes,
  storageConnected,
}: {
  nodes: NodeData[];
  storageConnected: boolean;
}) {
  const [nodeId, setNodeId] = useState(nodes[0]?.id ?? "node-1");
  const node = nodes.find((item) => item.id === nodeId) ?? nodes[0];
  const keys = useMemo<SensorKey[]>(
    () =>
      node
        ? (Object.keys(node.sensors) as SensorKey[]).filter(
            (key) => key !== "pir",
          )
        : [],
    [node],
  );
  const [sensor, setSensor] = useState<SensorKey>("acceleration");
  const activeSensor = keys.includes(sensor) ? sensor : keys[0];
  if (!node || !activeSensor) return null;
  const chart = node.history.map((point) => ({
    time: new Date(point.time).toLocaleTimeString("en-GB", {
      minute: "2-digit",
      second: "2-digit",
    }),
    value: point.sensors[activeSensor],
  }));
  const rows = [...node.history].reverse().slice(0, 18);
  const age = node.lastSeen
    ? Math.max(0, (Date.now() - Date.parse(node.lastSeen)) / 1000)
    : null;
  const validValues = chart.map((point) => point.value).filter((value): value is number => typeof value === "number");
  const average = validValues.length ? validValues.reduce((sum, value) => sum + value, 0) / validValues.length : null;
  const minimum = validValues.length ? Math.min(...validValues) : null;
  const maximum = validValues.length ? Math.max(...validValues) : null;
  const completeness = node.history.length ? Math.round(validValues.length / node.history.length * 100) : 0;
  const freshness = age == null ? 0 : age <= 2.5 ? 100 : Math.max(0, Math.round(100 - (age - 2.5) * 10));
  const streamQuality = node.online ? Math.round(completeness * 0.65 + freshness * 0.35) : 0;
  const hazard = highestHazard(node);
  const guide = sensorGuide[activeSensor];
  const confidenceReadings = [
    { label: "Rule evidence", value: node.online ? hazard.score : 0, detail: `${hazard.contributors.length}/${hazard.total} hazard signals agree`, tone: hazard.tier.toLowerCase() },
    { label: "ML pattern match", value: node.ml?.confidence ?? 0, detail: node.ml ? node.ml.label : "Building the live window", tone: node.ml?.hazard ? "warning" : "normal" },
    { label: "Data completeness", value: completeness, detail: `${validValues.length}/${node.history.length || 0} usable samples`, tone: completeness >= 80 ? "normal" : "watch" },
    { label: "Stream quality", value: streamQuality, detail: age == null ? "No packet received" : `${age.toFixed(1)} s packet age`, tone: streamQuality >= 80 ? "normal" : streamQuality >= 50 ? "watch" : "warning" },
  ];
  return (
    <div className="telemetry-workspace">
      <div className="telemetry-status-grid">
        <div className="neo telemetry-status-card">
          <Radio size={18} />
          <span>
            <small>PACKET STREAM</small>
            <strong>{node.online ? "Receiving live" : "Awaiting node"}</strong>
          </span>
          <i className={`status-dot ${node.online ? "" : "offline"}`} />
        </div>
        <div className="neo telemetry-status-card">
          <Clock3 size={18} />
          <span>
            <small>PACKET AGE</small>
            <strong>{age == null ? "—" : `${age.toFixed(1)} seconds`}</strong>
          </span>
        </div>
        <div className="neo telemetry-status-card">
          <BatteryMedium size={18} />
          <span>
            <small>NODE POWER</small>
            <strong>{node.online ? `${node.battery}%` : "—"}</strong>
          </span>
        </div>
        <div className="neo telemetry-status-card">
          <Database size={18} />
          <span>
            <small>SUPABASE ARCHIVE</small>
            <strong>
              {storageConnected ? "Writing packets" : "Not configured"}
            </strong>
          </span>
        </div>
      </div>
      <section className="neo telemetry-panel">
        <div className="telemetry-panel-head">
          <div>
            <span className="eyebrow">LIVE / 1.5 SECOND TICK</span>
            <h2>Continuous signal trace</h2>
            <p>
              Rolling five-minute server buffer. Select any physical channel.
            </p>
          </div>
          <div className="telemetry-node-tabs">
            {nodes.map((item) => (
              <button
                key={item.id}
                className={item.id === node.id ? "active" : ""}
                onClick={() => setNodeId(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
        <div className="telemetry-focus-bar">
          <label className="telemetry-sensor-select">
            <span>CHOOSE SENSOR GRAPH</span>
            <div>
              <select value={activeSensor} onChange={(event) => setSensor(event.target.value as SensorKey)}>
                {keys.map((key) => <option key={key} value={key}>{sensorMeta[key].name} · {sensorMeta[key].model}</option>)}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </div>
          </label>
          <div className="telemetry-current-reading">
            <span className="small-label">CURRENT READING</span>
            <strong>{display(activeSensor, node.sensors[activeSensor])}</strong>
            <small>{sensorStatus(activeSensor, node.sensors[activeSensor])} · {sensorMeta[activeSensor].model}</small>
          </div>
          <div className="telemetry-mini-stat">
            <span>AVERAGE</span>
            <strong>{average == null ? "—" : summaryValue(activeSensor, average, "average")}</strong>
          </div>
          <div className="telemetry-mini-stat">
            <span>OBSERVED RANGE</span>
            <strong>{minimum == null || maximum == null ? "—" : `${summaryValue(activeSensor, minimum, "range")} – ${summaryValue(activeSensor, maximum, "range")}`}</strong>
          </div>
        </div>
        <div
          className="telemetry-chart"
          aria-label={`${sensorMeta[activeSensor].name} live trend`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart}>
              <defs>
                <linearGradient id="liveSignal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6f9175" stopOpacity={0.34} />
                  <stop offset="100%" stopColor="#6f9175" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="#dfe7d6"
                strokeDasharray="3 6"
                vertical={false}
              />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 8, fill: "#8b968a" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 8, fill: "#8b968a" }}
                axisLine={false}
                tickLine={false}
                width={42}
                domain={sensorMeta[activeSensor].binary ? [0, 1] : ["auto", "auto"]}
                ticks={sensorMeta[activeSensor].binary ? [0, 1] : undefined}
              />
              <Tooltip
                contentStyle={{
                  background: "#f4f7ef",
                  border: "1px solid #d7e0d0",
                  borderRadius: 8,
                  fontSize: 10,
                }}
                formatter={(value) => [
                  `${Number(value).toFixed(activeSensor === "acceleration" ? 3 : 1)} ${sensorMeta[activeSensor].unit}`,
                  sensorMeta[activeSensor].name,
                ]}
              />
              {guide && <ReferenceLine y={guide.threshold} stroke="#b88a4b" strokeDasharray="5 5" label={{ value: guide.label, position: "insideTopRight", fill: "#9b7844", fontSize: 9 }} />}
              <Area
                type={sensorMeta[activeSensor].binary ? "stepAfter" : "monotone"}
                dataKey="value"
                stroke="#5f8268"
                strokeWidth={2}
                fill="url(#liveSignal)"
                isAnimationActive={false}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="telemetry-chart-caption">
          <span><i className="live-line-key" /> Live {sensorMeta[activeSensor].name.toLowerCase()} reading</span>
          {guide ? <span><i className="threshold-line-key" /> {guide.label}</span> : <span>Context sensor · no alert threshold</span>}
        </div>
        <div className="telemetry-chart-foot">
          <span>
            <Activity size={14} /> {chart.length} samples in memory
          </span>
          <span>
            <Cloud size={14} /> Every valid hardware packet is archived
          </span>
          <Badge tier={node.online ? highestHazard(node).tier : "Offline"} />
        </div>
      </section>
      <section className="neo telemetry-confidence-panel">
        <div className="section-heading">
          <h2><Gauge size={17} /> Live confidence breakdown</h2>
          <span className="muted">Four independent, continuously calculated indicators</span>
        </div>
        <p className="confidence-explainer">This is not one hard-coded probability. Judges can see what the rules detect, what the advisory model recognises, and whether the incoming data is complete and fresh.</p>
        <div className="telemetry-confidence-grid">
          {confidenceReadings.map((item) => (
            <div className="confidence-reading" key={item.label}>
              <div><span>{item.label}</span><strong>{item.value}%</strong></div>
              <div className={`confidence-meter meter-${item.tone}`}><span style={{ width: `${item.value}%` }} /></div>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="neo telemetry-table-panel">
        <div className="section-heading">
          <h2>Packet-by-packet readings</h2>
          <span className="muted">Newest first · updates continuously</span>
        </div>
        <div className="table-scroll">
          <table className="telemetry-table">
            <thead>
              <tr>
                <th>Time</th>
                {keys.map((key) => (
                  <th key={key}>{sensorMeta[key].name}</th>
                ))}
                <th>Rule risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.time}>
                  <td>{new Date(row.time).toLocaleTimeString("en-GB")}</td>
                  {keys.map((key) => (
                    <td key={key}>{display(key, row.sensors[key])}</td>
                  ))}
                  <td>
                    <strong>{row.score}%</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="prototype-strip">
        <Database size={17} />
        <span>
          <strong>Storage policy:</strong> raw hardware packets are immutable;
          alert rows are written only when a tier changes. Predictions stay
          reproducible from raw data instead of being duplicated.
        </span>
      </div>
    </div>
  );
}
