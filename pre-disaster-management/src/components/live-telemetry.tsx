"use client";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  BatteryMedium,
  Clock3,
  Cloud,
  Database,
  Radio,
} from "lucide-react";
import { NodeData, SensorKey, sensorMeta } from "@/lib/types";
import { Badge } from "./node-card";
import { highestHazard } from "@/lib/types";

function display(key: SensorKey, value: number | null | undefined) {
  const meta = sensorMeta[key];
  if (value == null) return "—";
  if (meta.binary) return value ? "ACTIVE" : "CLEAR";
  return `${value.toFixed(key === "acceleration" ? 3 : 1)} ${meta.unit}`;
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
        <div className="telemetry-sensor-tabs">
          {keys.map((key) => (
            <button
              key={key}
              className={activeSensor === key ? "active" : ""}
              onClick={() => setSensor(key)}
            >
              {sensorMeta[key].name}
              <strong>{display(key, node.sensors[key])}</strong>
            </button>
          ))}
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
              <Area
                type="monotone"
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
