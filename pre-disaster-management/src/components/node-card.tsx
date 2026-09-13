"use client";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Waves,
  BatteryMedium,
  Radio,
  ArrowUpRight,
  Footprints,
} from "lucide-react";
import {
  NodeData,
  SensorKey,
  Tier,
  highestHazard,
  sensorMeta,
  sensorStatus,
} from "@/lib/types";
import { MlStrip } from "./ml-panel";
export function AnimatedNumber({
  value,
  decimals = 0,
}: {
  value: number;
  decimals?: number;
}) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    const from = previous.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 300);
      setDisplay(from + (value - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    previous.current = value;
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{display.toFixed(decimals)}</>;
}
export function Badge({ tier }: { tier: Tier | "Offline" }) {
  return (
    <span className={`tier-badge tier-${tier.toLowerCase()}`}>
      <span />
      {tier}
    </span>
  );
}
export function Sparkline({
  values,
  elevated = false,
}: {
  values: number[];
  elevated?: boolean;
}) {
  const data = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const max = Math.max(...data, 1),
    min = Math.min(...data, 0);
  const points = data
    .map(
      (v, i) =>
        `${(i / (data.length - 1)) * 64},${23 - ((v - min) / (max - min || 1)) * 18}`,
    )
    .join(" ");
  return (
    <svg
      className={`sparkline ${elevated ? "elevated" : ""}`}
      viewBox="0 0 66 28"
      aria-label="Recent sensor history"
    >
      <path d="M0 25H66" stroke="currentColor" opacity=".12" />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function SensorRow({
  node,
  sensorKey,
}: {
  node: NodeData;
  sensorKey: SensorKey;
}) {
  const meta = sensorMeta[sensorKey];
  const value = node.sensors[sensorKey];
  const status = sensorStatus(sensorKey, value);
  const elevated = status === "Elevated" || status === "Triggered";
  const decimals =
    sensorKey === "acceleration"
      ? 3
      : sensorKey === "temperature" || sensorKey === "pressure"
        ? 1
        : 0;
  return (
    <div className={`sensor-row ${elevated ? "sensor-elevated" : ""}`}>
      <div className="sensor-info">
        <strong>{meta.name}</strong>
        <small>{meta.model}</small>
      </div>
      <Sparkline
        values={node.history.map((h) => h.sensors[sensorKey] ?? 0)}
        elevated={elevated}
      />
      <div className="sensor-value">
        <strong>
          {value == null ? (
            "—"
          ) : meta.binary ? (
            value ? (
              sensorKey === "float" ? (
                "High"
              ) : (
                "Active"
              )
            ) : sensorKey === "float" ? (
              "Low"
            ) : (
              "Quiet"
            )
          ) : (
            <>
              <AnimatedNumber value={value} decimals={decimals} />
              <span> {meta.unit}</span>
            </>
          )}
        </strong>
        <small
          className={
            elevated ? "text-amber" : value == null ? "" : "text-green"
          }
        >
          <i />
          {status}
        </small>
      </div>
    </div>
  );
}
export default function NodeCard({
  node,
  onSelect,
}: {
  node: NodeData;
  onSelect: (id: string) => void;
}) {
  const hazard = highestHazard(node);
  const seismic = node.id === "node-1";
  return (
    <article
      className={`node-card neo ${hazard.tier === "Critical" ? "critical-card" : ""}`}
    >
      <div className="node-card-heading">
        <div className="node-icon">
          {seismic ? <Activity size={22} /> : <Waves size={22} />}
        </div>
        <div>
          <h3>{node.name}</h3>
          <p>{node.subtitle}</p>
        </div>
        <span className={`online-tag ${node.online ? "" : "offline"}`}>
          <i />
          {node.online ? "Online" : "Offline"}
        </span>
      </div>
      <div className="node-meta">
        <span>
          <Radio size={12} /> USB serial · 115200
        </span>
        <span>
          <BatteryMedium size={15} /> {node.online ? `${node.battery}%` : "—"}
        </span>
      </div>
      <div className="last-seen">
        Last seen{" "}
        <span>
          {node.lastSeen
            ? new Date(node.lastSeen).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })
            : "Awaiting first packet"}
        </span>
      </div>
      <div className="node-score">
        <div>
          <span className="small-label">HAZARD CONFIDENCE</span>
          <div className="score-value">
            {node.online ? <AnimatedNumber value={hazard.score} /> : "—"}
            <span>%</span>
          </div>
        </div>
        <div className="node-score-status">
          <Badge tier={node.online ? hazard.tier : "Offline"} />
          <small>
            {node.online
              ? `${hazard.contributors.length}/${hazard.total} signals corroborating`
              : "Awaiting USB data"}
          </small>
        </div>
      </div>
      <div className={`confidence-track tier-${hazard.tier.toLowerCase()}`}>
        <span style={{ width: `${node.online ? hazard.score : 0}%` }} />
      </div>
      <div className="sensor-list">
        {(Object.keys(node.sensors) as SensorKey[])
          .filter((k) => k !== "pir")
          .map((key) => (
            <SensorRow key={key} node={node} sensorKey={key} />
          ))}
      </div>
      {!seismic ? (
        <div className="context-signal">
          <Footprints size={14} />
          <span>
            PIR ·{" "}
            {node.sensors.pir == null
              ? "No data"
              : node.sensors.pir
                ? "Presence detected"
                : "No presence"}
            <small>Context only · excluded from risk score</small>
          </span>
        </div>
      ) : (
        <div className="node-baseline">
          <span className="status-dot" />{" "}
          {hazard.tier === "Normal"
            ? "Sensors within normal baseline"
            : "Corroborating signals detected"}
        </div>
      )}
      <MlStrip node={node} />
      <button className="node-details-button" onClick={() => onSelect(node.id)}>
        View node details <ArrowUpRight size={15} />
      </button>
    </article>
  );
}
