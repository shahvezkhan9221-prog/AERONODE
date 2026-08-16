"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import CommandMap from "./CommandMap";

type Priority = "critical" | "normal";
type Signal = {
  id: string;
  name: string;
  nodeId: string;
  message: string;
  priority: Priority;
  receivedAt: string;
  lat?: number;
  lng?: number;
  battery?: number;
};
type NodeUnit = {
  id: string;
  label: string;
  online: boolean;
  battery?: number;
  rssi?: number;
  lat?: number;
  lng?: number;
};
type LogItem = { id: number; at: string; type: "RX" | "TX" | "INFO" | "ERROR"; text: string };
type SerialPortLike = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
};
type SerialNavigator = Navigator & { serial?: { requestPort(): Promise<SerialPortLike> } };

const timeNow = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const numberOrUndefined = (value: unknown) => value === undefined || value === null || value === "" ? undefined : Number(value);

export default function Home() {
  const [nodes, setNodes] = useState<NodeUnit[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [reply, setReply] = useState("");
  const [logs, setLogs] = useState<LogItem[]>([
    { id: 1, at: "--:--:--", type: "INFO", text: "Ready. Connect the ESP32 gateway to begin." },
  ]);
  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const readTaskRef = useRef<Promise<void> | null>(null);
  const keepReadingRef = useRef(false);

  const selected = signals.find((signal) => signal.id === selectedId) ?? null;
  const locatedSignals = useMemo(() => signals.filter((signal) => Number.isFinite(signal.lat) && Number.isFinite(signal.lng)), [signals]);
  const locatedNodes = useMemo(() => nodes.filter((node) => Number.isFinite(node.lat) && Number.isFinite(node.lng)), [nodes]);

  const addLog = useCallback((type: LogItem["type"], text: string) => {
    setLogs((current) => [...current.slice(-19), { id: Date.now() + Math.random(), at: timeNow(), type, text }]);
  }, []);

  const upsertSignal = useCallback((next: Signal) => {
    setSignals((current) => current.some((item) => item.id === next.id)
      ? current.map((item) => item.id === next.id ? { ...item, ...next } : item)
      : [next, ...current]);
    setSelectedId(next.id);
  }, []);

  const applyLine = useCallback((line: string) => {
    const text = line.trim();
    if (!text) return;

    let packet: Record<string, unknown> | null = null;
    try {
      const jsonStart = text.indexOf("{");
      if (jsonStart >= 0) packet = JSON.parse(text.slice(jsonStart)) as Record<string, unknown>;
    } catch { packet = null; }

    if (packet) {
      const type = String(packet.type ?? "message").toLowerCase();
      const nodeId = String(packet.nodeId ?? packet.node_id ?? "GATEWAY");
      if (type === "telemetry" || type === "node" || type === "heartbeat") {
        const next: NodeUnit = {
          id: nodeId,
          label: String(packet.label ?? nodeId),
          online: true,
          lat: numberOrUndefined(packet.lat),
          lng: numberOrUndefined(packet.lng ?? packet.lon),
          battery: numberOrUndefined(packet.battery),
          rssi: numberOrUndefined(packet.rssi),
        };
        setNodes((current) => current.some((node) => node.id === nodeId)
          ? current.map((node) => node.id === nodeId ? { ...node, ...next } : node)
          : [next, ...current]);
        addLog("RX", `${nodeId} telemetry received`);
        return;
      }

      if (["sos", "message", "member", "user"].includes(type)) {
        const id = String(packet.userId ?? packet.user_id ?? packet.id ?? `SIG-${Date.now()}`);
        const next: Signal = {
          id,
          name: String(packet.name ?? (type === "sos" ? "SOS signal" : "Nearby user")),
          nodeId,
          message: String(packet.message ?? packet.text ?? "Signal received"),
          priority: String(packet.priority ?? packet.status).toLowerCase() === "critical" || type === "sos" ? "critical" : "normal",
          lat: numberOrUndefined(packet.lat),
          lng: numberOrUndefined(packet.lng ?? packet.lon),
          battery: numberOrUndefined(packet.battery),
          receivedAt: timeNow(),
        };
        upsertSignal(next);
        addLog("RX", `${nodeId} · ${next.message}`);
        return;
      }

      addLog("RX", `${nodeId} · ${String(packet.message ?? type)}`);
      return;
    }

    const legacy = text.match(/^(PHONE|RELAY):\s*(.+)$/i);
    if (legacy) {
      const next: Signal = {
        id: `SIG-${Date.now()}`,
        name: legacy[1].toUpperCase() === "PHONE" ? "Phone message" : "Relay message",
        nodeId: "GATEWAY",
        message: legacy[2],
        priority: "normal",
        receivedAt: timeNow(),
      };
      upsertSignal(next);
      addLog("RX", next.message);
      return;
    }

    if (/RSSI|SNR|LORA MESSAGE/i.test(text)) addLog("RX", text.replace(/=/g, "").trim());
  }, [addLog, upsertSignal]);

  const readSerial = useCallback(async (port: SerialPortLike) => {
    const reader = port.readable.getReader();
    readerRef.current = reader;
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (keepReadingRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        lines.forEach(applyLine);
      }
    } catch (error) {
      if (keepReadingRef.current) addLog("ERROR", `Serial connection lost: ${(error as Error).message}`);
    } finally {
      try { reader.releaseLock(); } catch { setConnected(false); }
      readerRef.current = null;
      if (keepReadingRef.current) {
        keepReadingRef.current = false;
        portRef.current = null;
        setConnected(false);
      }
    }
  }, [addLog, applyLine]);

  const connectSerial = async () => {
    const serial = (navigator as SerialNavigator).serial;
    if (!serial) {
      addLog("ERROR", "Web Serial is not supported here. Use Chrome or Edge over HTTPS.");
      return;
    }
    setConnecting(true);
    try {
      const port = await serial.requestPort();
      await port.open({ baudRate: 115200 });
      portRef.current = port;
      keepReadingRef.current = true;
      setConnected(true);
      setConnecting(false);
      addLog("INFO", "ESP32 connected at 115200 baud");
      const task = readSerial(port);
      readTaskRef.current = task;
      void task.finally(() => { readTaskRef.current = null; });
    } catch (error) {
      setConnected(false);
      if ((error as Error).name !== "NotFoundError") addLog("ERROR", `Could not connect: ${(error as Error).message}`);
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    keepReadingRef.current = false;
    try { await readerRef.current?.cancel(); } catch { setConnected(false); }
    try { await readTaskRef.current; } catch { setConnected(false); }
    try { await portRef.current?.close(); } catch { setConnected(false); }
    portRef.current = null;
    setConnected(false);
    addLog("INFO", "ESP32 disconnected");
  };

  const sendReply = async () => {
    const message = reply.trim();
    if (!message || !selected || !portRef.current?.writable) return;
    const payload = JSON.stringify({ type: "reply", to: selected.id, nodeId: selected.nodeId, message, ts: Date.now() });
    try {
      const writer = portRef.current.writable.getWriter();
      await writer.write(new TextEncoder().encode(`${payload}\n`));
      writer.releaseLock();
      setReply("");
      addLog("TX", `${selected.id} · ${message}`);
    } catch (error) { addLog("ERROR", `Send failed: ${(error as Error).message}`); }
  };

  return (
    <main className="app-shell">
      <header className="app-header glass">
        <div className="logo" aria-label="Aero-Node"><span>A</span><div><b>Aero-Node</b><small>Rescue dashboard</small></div></div>
        <div className={`connection-pill ${connected ? "online" : ""}`}><i />{connected ? "Gateway online" : "Gateway offline"}</div>
        <button className={`connect-button ${connected ? "disconnect" : ""}`} onClick={connected ? disconnect : connectSerial} disabled={connecting}>
          <span>{connected ? "✓" : "⌁"}</span>{connecting ? "Choose a port…" : connected ? "Disconnect" : "Connect ESP32"}
        </button>
      </header>

      <section className="hero-row">
        <div><p>LIVE MESH</p><h1>Rescue signals, clearly.</h1><span>Connect your gateway and incoming nodes, people, messages and locations appear here automatically.</span></div>
        <div className="quick-stats glass"><div><strong>{nodes.length}</strong><small>Nodes</small></div><div><strong>{signals.length}</strong><small>Signals</small></div><div><strong>{signals.filter((signal) => signal.priority === "critical").length}</strong><small>Critical</small></div></div>
      </section>

      <section className="dashboard-grid">
        <section className="map-card glass">
          <div className="card-heading"><div><small>LIVE MAP</small><h2>Located devices</h2></div><span>{locatedNodes.length + locatedSignals.length} mapped</span></div>
          <div className="map-wrap">
            <CommandMap nodes={locatedNodes} people={locatedSignals} selectedId={selectedId ?? ""} onSelect={setSelectedId} />
            {locatedNodes.length + locatedSignals.length === 0 && <div className="map-empty glass"><span>⌖</span><b>Waiting for a location</b><small>Send a JSON packet with lat and lng from your node.</small></div>}
          </div>
        </section>

        <aside className="side-stack">
          <section className="signals-card glass">
            <div className="card-heading"><div><small>INBOX</small><h2>Incoming signals</h2></div>{signals.length > 0 && <button onClick={() => { setSignals([]); setSelectedId(null); }}>Clear</button>}</div>
            <div className="signal-list">
              {signals.length === 0 ? <div className="empty-state"><span>◎</span><b>No signals yet</b><small>Messages received over Serial will appear here.</small></div> : signals.map((signal) => (
                <button key={signal.id} className={`signal-item ${selectedId === signal.id ? "selected" : ""}`} onClick={() => setSelectedId(signal.id)}>
                  <i className={signal.priority} /><div><b>{signal.name}</b><p>{signal.message}</p><small>{signal.nodeId} · {signal.receivedAt}{signal.lat !== undefined ? " · located" : ""}</small></div>
                </button>
              ))}
            </div>
          </section>

          <section className="reply-card glass">
            {selected ? <><div className="reply-title"><div><small>REPLY TO</small><h3>{selected.name}</h3></div><span>{selected.nodeId}</span></div><p>{selected.message}</p><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder={connected ? "Write a reply…" : "Connect the gateway to reply"} disabled={!connected} /><button onClick={sendReply} disabled={!connected || !reply.trim()}>Send via LoRa <span>→</span></button></> : <div className="empty-state compact"><span>↗</span><b>Select a signal</b><small>Choose a message above to send a reply.</small></div>}
          </section>
        </aside>
      </section>

      <section className="activity glass">
        <div className="activity-title"><div><i className={connected ? "active" : ""} /><b>Serial activity</b></div><span>115200 baud</span></div>
        <div className="log-list">{logs.slice(-5).map((log) => <div key={log.id}><time>{log.at}</time><b className={log.type.toLowerCase()}>{log.type}</b><p>{log.text}</p></div>)}</div>
      </section>
    </main>
  );
}
