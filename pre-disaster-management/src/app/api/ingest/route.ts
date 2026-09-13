import { NextResponse } from "next/server";
import { monitor } from "@/lib/monitor";
import { db } from "@/db";
import { telemetrySamples } from "@/db/schema";
import { isOperator } from "@/lib/auth";
export async function POST(request: Request) {
  const token = process.env.GATEWAY_TOKEN;
  const gatewayAuthorized =
    !!token && request.headers.get("authorization") === `Bearer ${token}`;
  const browserAuthorized = await isOperator();
  if (!gatewayAuthorized && !browserAuthorized)
    return NextResponse.json(
      { error: "Unauthorized sensor connection" },
      { status: 401 },
    );
  const d = await request.json().catch(() => null);
  if (
    !d ||
    !["node-1", "node-2"].includes(d.nodeId) ||
    !d.sensors ||
    !Number.isFinite(d.battery) ||
    d.battery < 0 ||
    d.battery > 100 ||
    typeof d.timestamp !== "string" ||
    !Number.isFinite(Date.parse(d.timestamp)) ||
    Math.abs(Date.now() - Date.parse(d.timestamp)) > 60000
  )
    return NextResponse.json(
      {
        error:
          "Invalid node, battery, sensors, or timestamp (must be within 60 seconds).",
      },
      { status: 400 },
    );
  const requiredKeys =
    d.nodeId === "node-1"
      ? ["acceleration", "shock", "sound"]
      : ["moisture", "float", "rain"];
  const optionalKeys =
    d.nodeId === "node-2" ? ["temperature", "pressure", "pir"] : [];
  const keys = [
    ...requiredKeys,
    ...optionalKeys.filter((key) => key in d.sensors),
  ];
  for (const key of requiredKeys)
    if (!(key in d.sensors))
      return NextResponse.json(
        { error: `Missing sensor: ${key}` },
        { status: 400 },
      );
  for (const key of keys) {
    const v = d.sensors[key];
    if (v === null) continue;
    const max =
      key === "acceleration"
        ? 32
        : key === "temperature"
          ? 85
          : key === "pressure"
            ? 1200
            : 100;
    const min = key === "temperature" ? -40 : key === "pressure" ? 300 : 0;
    if (
      !Number.isFinite(v) ||
      v < min ||
      v > max ||
      (["shock", "sound", "float", "pir"].includes(key) && v !== 0 && v !== 1)
    )
      return NextResponse.json(
        { error: `Invalid sensor: ${key}` },
        { status: 400 },
      );
  }
  if (
    d.location &&
    (!Number.isFinite(d.location.lat) ||
      Math.abs(d.location.lat) > 90 ||
      !Number.isFinite(d.location.lng) ||
      Math.abs(d.location.lng) > 180)
  )
    return NextResponse.json(
      { error: "Invalid GPS coordinates" },
      { status: 400 },
    );
  if (
    d.rssi != null &&
    (!Number.isFinite(d.rssi) || d.rssi < -160 || d.rssi > 20)
  )
    return NextResponse.json({ error: "Invalid RSSI" }, { status: 400 });
  if (d.snr != null && (!Number.isFinite(d.snr) || d.snr < -30 || d.snr > 30))
    return NextResponse.json({ error: "Invalid SNR" }, { status: 400 });
  const packet = {
    nodeId: d.nodeId,
    sensors: Object.fromEntries(keys.map((k) => [k, d.sensors[k]])),
    battery: d.battery,
    timestamp: d.timestamp,
    location: d.location,
    rssi: d.rssi,
    snr: d.snr,
  };
  monitor.ingest(packet);
  let persisted = false;
  if (db)
    try {
      await db.insert(telemetrySamples).values({
        id: crypto.randomUUID(),
        timestamp: new Date(d.timestamp),
        nodeId: d.nodeId,
        battery: Math.round(d.battery),
        sensors: packet.sensors,
        location: d.location ?? null,
        rssi: d.rssi == null ? null : Math.round(d.rssi),
        snr: d.snr ?? null,
      });
      persisted = true;
      monitor.setStorageConnected(true);
    } catch (error) {
      monitor.setStorageConnected(false);
      console.error(
        "Telemetry persistence unavailable",
        error instanceof Error ? error.message : error,
      );
    }
  return NextResponse.json({ accepted: true, persisted });
}
