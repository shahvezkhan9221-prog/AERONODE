"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CommandMap from "./CommandMap";

type Status = "critical" | "warning" | "stable";
type Person = { id: string; name: string; nodeId: string; lat: number; lng: number; message: string; status: Status; lastSeen: string; battery?: number };
type NodeUnit = { id: string; label: string; lat: number; lng: number; online: boolean; rssi: number; battery: number; people: number };
type LogItem = { id: number; at: string; direction: "RX" | "TX" | "SYS"; text: string };
type SerialPortLike = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
};
type SerialNavigator = Navigator & { serial?: { requestPort(): Promise<SerialPortLike> } };

const initialNodes: NodeUnit[] = [
  { id: "AN-01", label: "North Relay", lat: 23.0267, lng: 72.5689, online: true, rssi: -78, battery: 86, people: 3 },
  { id: "AN-02", label: "Market Sector", lat: 23.0219, lng: 72.5752, online: true, rssi: -91, battery: 64, people: 5 },
  { id: "AN-03", label: "South Corridor", lat: 23.0178, lng: 72.5706, online: true, rssi: -84, battery: 72, people: 2 },
  { id: "AN-04", label: "East Perimeter", lat: 23.0231, lng: 72.5821, online: false, rssi: -118, battery: 19, people: 0 },
];

const initialPeople: Person[] = [
  { id: "SUR-218", name: "Unknown survivor", nodeId: "AN-02", lat: 23.0227, lng: 72.5743, message: "Trapped under stairwell. Two people here.", status: "critical", lastSeen: "12 sec ago", battery: 34 },
  { id: "MED-014", name: "A. Khan · Medic", nodeId: "AN-01", lat: 23.0274, lng: 72.5678, message: "Triage point established. Need water.", status: "stable", lastSeen: "48 sec ago", battery: 71 },
  { id: "SUR-205", name: "Meera P.", nodeId: "AN-03", lat: 23.0185, lng: 72.5718, message: "Injured leg. Can hear rescuers nearby.", status: "warning", lastSeen: "2 min ago", battery: 18 },
  { id: "TEAM-07", name: "Recon Team 07", nodeId: "AN-01", lat: 23.0256, lng: 72.5708, message: "Moving toward Sector R7.", status: "stable", lastSeen: "3 min ago", battery: 82 },
];

function clock() { return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function packetText(packet: Record<string, unknown>) { return String(packet.message ?? packet.text ?? packet.type ?? "Packet received"); }

export default function Home() {
  const [nodes, setNodes] = useState(initialNodes);
  const [people, setPeople] = useState(initialPeople);
  const [selectedId, setSelectedId] = useState("SUR-218");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [reply, setReply] = useState("");
  const [filter, setFilter] = useState<"all" | "critical" | "teams">("all");
  const [logs, setLogs] = useState<LogItem[]>([
    { id: 1, at: "09:42:18", direction: "SYS", text: "Dashboard ready · waiting for serial gateway" },
    { id: 2, at: "09:42:24", direction: "RX", text: "AN-02 heartbeat · RSSI -91 dBm" },
  ]);
  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const keepReadingRef = useRef(false);

  const selected = people.find((person) => person.id === selectedId) ?? people[0];
  const visiblePeople = useMemo(() => people.filter((person) => filter === "critical" ? person.status === "critical" : filter === "teams" ? person.id.startsWith("TEAM") || person.id.startsWith("MED") : true), [filter, people]);
  const addLog = useCallback((direction: LogItem["direction"], text: string) => setLogs((current) => [...current.slice(-39), { id: Date.now() + Math.random(), at: clock(), direction, text }]), []);

  const applyPacket = useCallback((line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let packet: Record<string, unknown> | null = null;
    try { const start = trimmed.indexOf("{"); if (start >= 0) packet = JSON.parse(trimmed.slice(start)); } catch { packet = null; }

    if (packet) {
      const type = String(packet.type ?? "message").toLowerCase();
      const nodeId = String(packet.nodeId ?? packet.node_id ?? "AN-USB");
      if (type === "telemetry" || type === "node") {
        setNodes((current) => {
          const next: NodeUnit = { id: nodeId, label: String(packet.label ?? nodeId), lat: Number(packet.lat ?? 23.0225), lng: Number(packet.lng ?? packet.lon ?? 72.5714), online: true, rssi: Number(packet.rssi ?? -80), battery: Number(packet.battery ?? 100), people: Number(packet.people ?? 0) };
          return current.some((n) => n.id === nodeId) ? current.map((n) => n.id === nodeId ? { ...n, ...next } : n) : [...current, next];
        });
      }
      if (["sos", "message", "member", "user"].includes(type)) {
        const fallback = nodes.find((n) => n.id === nodeId) ?? initialNodes[1];
        const id = String(packet.userId ?? packet.user_id ?? packet.id ?? `SUR-${String(Date.now()).slice(-3)}`);
        const person: Person = { id, name: String(packet.name ?? "Unknown survivor"), nodeId, lat: Number(packet.lat ?? fallback.lat), lng: Number(packet.lng ?? packet.lon ?? fallback.lng), message: packetText(packet), status: (packet.priority ?? packet.status ?? "critical") as Status, lastSeen: "just now", battery: packet.battery == null ? undefined : Number(packet.battery) };
        setPeople((current) => current.some((p) => p.id === id) ? current.map((p) => p.id === id ? { ...p, ...person } : p) : [person, ...current]);
        setSelectedId(id);
      }
      addLog("RX", `${nodeId} · ${packetText(packet)}`);
      return;
    }
    if (trimmed.startsWith("PHONE:") || trimmed.startsWith("RELAY:")) {
      const text = trimmed.replace(/^(PHONE|RELAY):\s*/, "");
      const id = `SUR-${String(Date.now()).slice(-3)}`;
      setPeople((current) => [{ id, name: "Unregistered device", nodeId: "AN-02", lat: initialNodes[1].lat, lng: initialNodes[1].lng, message: text, status: "warning", lastSeen: "just now" }, ...current]);
      setSelectedId(id); addLog("RX", text);
    } else if (trimmed.includes("RSSI") || trimmed.includes("LORA MESSAGE")) addLog("RX", trimmed.replace(/=/g, "").trim());
  }, [addLog, nodes]);

  const disconnect = useCallback(async () => {
    keepReadingRef.current = false;
    try { await readerRef.current?.cancel(); } catch { setConnected(false); }
    try { readerRef.current?.releaseLock(); } catch { setConnected(false); }
    try { await portRef.current?.close(); } catch { setConnected(false); }
    readerRef.current = null; portRef.current = null; setConnected(false); addLog("SYS", "Serial gateway disconnected");
  }, [addLog]);

  const connectSerial = async () => {
    const serial = (navigator as SerialNavigator).serial;
    if (!serial) { addLog("SYS", "Web Serial is unavailable. Open this page in Chrome or Edge."); return; }
    setConnecting(true);
    try {
      const port = await serial.requestPort();
      await port.open({ baudRate: 115200 });
      portRef.current = port; keepReadingRef.current = true; setConnected(true); addLog("SYS", "ESP32 gateway connected at 115200 baud");
      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable).catch(() => undefined);
      const reader = decoder.readable.getReader(); readerRef.current = reader;
      let buffer = "";
      while (keepReadingRef.current) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += value ?? ""; const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ""; lines.forEach(applyPacket);
      }
    } catch (error) {
      if ((error as Error).name !== "NotFoundError") addLog("SYS", `Connection failed: ${(error as Error).message}`);
      setConnected(false);
    } finally { setConnecting(false); }
  };

  const sendReply = async () => {
    const text = reply.trim(); if (!text || !selected) return;
    const payload = JSON.stringify({ type: "reply", to: selected.id, nodeId: selected.nodeId, message: text, ts: Date.now() });
    try {
      if (connected && portRef.current?.writable) { const writer = portRef.current.writable.getWriter(); await writer.write(new TextEncoder().encode(payload + "\n")); writer.releaseLock(); }
      addLog("TX", `${selected.nodeId} → ${selected.id} · ${text}`); setReply("");
    } catch (error) { addLog("SYS", `Send failed: ${(error as Error).message}`); }
  };

  useEffect(() => () => { keepReadingRef.current = false; readerRef.current?.cancel().catch(() => undefined); }, []);
  const onlineCount = nodes.filter((n) => n.online).length;
  const criticalCount = people.filter((p) => p.status === "critical").length;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">A</span><div><strong>AERO-NODE</strong><small>RESCUE COMMAND</small></div></div>
        <div className="incident"><span className="live-dot" /> {connected ? "LIVE GATEWAY" : "TRAINING DATA"} <b>·</b> SECTOR R7 <small>OP-2026-0816</small></div>
        <div className="header-actions"><div className="secure"><span>◆</span><div><b>LOCAL BRIDGE</b><small>operator console</small></div></div><button className={connected ? "port-button connected" : "port-button"} onClick={connected ? disconnect : connectSerial} disabled={connecting}><span className="usb">⌁</span>{connecting ? "CONNECTING…" : connected ? "ESP32 CONNECTED" : "CONNECT ESP32"}</button><button className="avatar" aria-label="Operator profile">RK</button></div>
      </header>

      <section className="metrics">
        <div><small>FIELD NODES</small><strong>{onlineCount}<em>/ {nodes.length} online</em></strong></div>
        <div><small>PEOPLE LOCATED</small><strong>{people.length}<em>across mesh</em></strong></div>
        <div><small>CRITICAL SOS</small><strong className="danger">{criticalCount}<em>requires action</em></strong></div>
        <div><small>GATEWAY SIGNAL</small><strong>{connected ? "USB" : "—"}<em>{connected ? "115200 baud" : "not connected"}</em></strong></div>
        <div className="mesh-health"><small>MESH HEALTH</small><span><i style={{ width: `${(onlineCount / nodes.length) * 100}%` }} /></span><strong>{Math.round((onlineCount / nodes.length) * 100)}%</strong></div>
      </section>

      <section className="workspace">
        <aside className="left-panel panel">
          <div className="panel-title"><div><small>LIVE FIELD INDEX</small><h2>Nodes & people</h2></div><button aria-label="Search">⌕</button></div>
          <div className="filter-row">{(["all", "critical", "teams"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? `ALL ${people.length}` : value.toUpperCase()}</button>)}</div>
          <div className="people-list">{visiblePeople.map((person) => <button key={person.id} className={`person ${selectedId === person.id ? "selected" : ""}`} onClick={() => setSelectedId(person.id)}><span className={`person-icon ${person.status}`}>{person.id.startsWith("TEAM") || person.id.startsWith("MED") ? "✚" : "●"}</span><span className="person-copy"><b>{person.name}</b><small>{person.id} · via {person.nodeId}</small><em>{person.message}</em></span><span className="person-time">{person.lastSeen}</span></button>)}</div>
          <div className="node-strip"><small>DEPLOYED HARDWARE</small>{nodes.map((node) => <div key={node.id}><span className={node.online ? "node-beacon" : "node-beacon offline"}>⌁</span><b>{node.id}</b><em>{node.battery}%</em><i>{node.online ? `${node.rssi} dBm` : "OFFLINE"}</i></div>)}</div>
        </aside>

        <div className="map-panel panel"><div className="map-tools"><span className="map-label">LIVE OPERATIONS MAP <b>{people.length + nodes.length} SIGNALS</b></span><div><button title="Center map">◎</button><button title="Map layers">▱</button></div></div><CommandMap nodes={nodes} people={visiblePeople} selectedId={selectedId} onSelect={setSelectedId} /><div className="map-legend"><span><i className="legend-pin critical" />Critical SOS</span><span><i className="legend-pin stable" />Member</span><span><i className="legend-node" />Aero-Node</span></div></div>

        <aside className="right-panel panel">{selected ? <><div className="case-head"><span className={`case-icon ${selected.status}`}>●</span><div><small>{selected.status.toUpperCase()} SIGNAL</small><h2>{selected.name}</h2><p>{selected.id} · {selected.nodeId}</p></div><button aria-label="More case actions">•••</button></div><div className="case-coordinates"><div><small>LAST LOCATION</small><b>{selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}</b></div><button title="Copy coordinates" onClick={() => navigator.clipboard?.writeText(`${selected.lat}, ${selected.lng}`)}>□</button></div><div className="message-card"><small>INCOMING MESSAGE · {selected.lastSeen}</small><p>“{selected.message}”</p><div><span>NODE {selected.nodeId}</span><span>{selected.battery ? `PHONE ${selected.battery}%` : "BATTERY N/A"}</span></div></div><div className="quick-actions"><button onClick={() => setReply("Rescue team is en route. Stay where you are and conserve phone battery.")}>DISPATCH TEAM</button><button onClick={() => setReply("Reply with the number of people and any serious injuries.")}>REQUEST TRIAGE</button></div><label className="reply-box"><span>REPLY TO {selected.id}</span><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Type command or reassurance…" onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) sendReply(); }} /><div><small>{reply.length}/220 · Ctrl + Enter</small><button onClick={sendReply} disabled={!reply.trim()}>SEND VIA LoRa <span>→</span></button></div></label><div className="case-meta"><div><small>ROUTED THROUGH</small><b>{selected.nodeId}</b></div><div><small>EST. ACCURACY</small><b>± 8 m</b></div><div><small>PACKET CHECK</small><b className="trusted">CRC PASS</b></div></div></> : <p>No active signal selected.</p>}</aside>
      </section>

      <section className="console panel"><div className="console-head"><div><span className={connected ? "console-led active" : "console-led"} /><b>SERIAL GATEWAY</b><small>{connected ? "USB · 115200 · STREAMING" : "USB · DISCONNECTED"}</small></div><button onClick={() => setLogs([])}>CLEAR LOG</button></div><div className="console-lines">{logs.slice(-8).map((log) => <div key={log.id}><time>{log.at}</time><span className={`dir ${log.direction.toLowerCase()}`}>{log.direction}</span><p>{log.text}</p></div>)}</div></section>
      <footer><span>OFF-GRID MODE · LOCAL-FIRST COMMAND SURFACE</span><span>433.000 MHz <b>·</b> LoRa CRC ON <b>·</b> SF7 / BW125</span><span>SESSION {connected ? "LIVE" : "STANDBY"}</span></footer>
    </main>
  );
}
