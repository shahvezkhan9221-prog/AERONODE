"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import CommandMap from "./CommandMap";

type Priority = "critical" | "normal";
type View = "map" | "people" | "traffic";
type Person = { id: string; name: string; nodeId: string; priority: Priority; lastMessage: string; lastSeen: string; lat?: number; lng?: number; online: boolean; locationKind?: "exact" | "approximate" };
type ChatMessage = { id: string; userId: string; direction: "incoming" | "outgoing"; text: string; at: string; priority: Priority };
type NodeUnit = { id: string; label: string; online: boolean; battery?: number; rssi?: number; lat?: number; lng?: number; clients?: number };
type LogItem = { id: number; at: string; type: "RX" | "TX" | "INFO" | "ERROR"; text: string; bytes: number };
type SerialPortLike = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>; open(options: { baudRate: number }): Promise<void>; close(): Promise<void> };
type SerialNavigator = Navigator & { serial?: { requestPort(): Promise<SerialPortLike> } };

const timeNow = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const numberOrUndefined = (value: unknown) => {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

export default function Home() {
  const [view, setView] = useState<View>("map");
  const [nodes, setNodes] = useState<NodeUnit[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [locationState, setLocationState] = useState<"idle" | "locating" | "located" | "denied">("idle");
  const [reply, setReply] = useState("");
  const [logs, setLogs] = useState<LogItem[]>([{ id: 1, at: "--:--:--", type: "INFO", text: "Ready. Connect the ESP32 gateway to begin.", bytes: 0 }]);
  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const readTaskRef = useRef<Promise<void> | null>(null);
  const keepReadingRef = useRef(false);

  const selected = people.find((person) => person.id === selectedId) ?? null;
  const selectedMessages = useMemo(() => messages.filter((message) => message.userId === selectedId), [messages, selectedId]);
  const locatedPeople = useMemo(() => people.filter((person) => Number.isFinite(person.lat) && Number.isFinite(person.lng)), [people]);
  const locatedNodes = useMemo(() => nodes.filter((node) => Number.isFinite(node.lat) && Number.isFinite(node.lng)), [nodes]);
  const wifiUsers = useMemo(() => nodes.reduce((total, node) => total + (node.clients ?? 0), 0), [nodes]);
  const unreadCritical = people.filter((person) => person.priority === "critical").length;
  const placeholderCount = Math.max(0, wifiUsers - people.length);
  const approximatePeople = useMemo<Person[]>(() => {
    const master = nodes.find((node) => node.id === "MASTER" && Number.isFinite(node.lat) && Number.isFinite(node.lng));
    if (!master) return [];
    const unlocated = people.filter((person) => !Number.isFinite(person.lat) || !Number.isFinite(person.lng));
    const total = unlocated.length + placeholderCount;
    if (total < 1) return [];
    const aroundMaster = (index: number) => {
      const angle = (index / total) * Math.PI * 2;
      const radius = 0.00018 + (index % 2) * 0.00007;
      return { lat: (master.lat as number) + Math.cos(angle) * radius, lng: (master.lng as number) + Math.sin(angle) * radius };
    };
    const checkedIn = unlocated.map((person, index) => ({ ...person, ...aroundMaster(index), locationKind: "approximate" as const }));
    const unknown = Array.from({ length: placeholderCount }, (_, index) => ({ id: `UNREGISTERED-${index + 1}`, name: `Connected device ${index + 1}`, nodeId: "MASTER", priority: "normal" as const, lastMessage: "Waiting for rescue portal check-in", lastSeen: "online", online: true, ...aroundMaster(unlocated.length + index), locationKind: "approximate" as const }));
    return [...checkedIn, ...unknown];
  }, [nodes, people, placeholderCount]);
  const mappedPeople = useMemo(() => [...locatedPeople, ...approximatePeople], [locatedPeople, approximatePeople]);

  const addLog = useCallback((type: LogItem["type"], text: string) => {
    setLogs((current) => [...current.slice(-79), { id: Date.now() + Math.random(), at: timeNow(), type, text, bytes: new TextEncoder().encode(text).byteLength }]);
  }, []);

  const upsertPerson = useCallback((next: Person) => {
    setPeople((current) => current.some((person) => person.id === next.id)
      ? current.map((person) => person.id === next.id ? { ...person, ...next, lat: next.lat ?? person.lat, lng: next.lng ?? person.lng, lastMessage: next.lastMessage || person.lastMessage } : person)
      : [next, ...current]);
  }, []);

  const locateMaster = useCallback(() => {
    if (!navigator.geolocation) { setLocationState("denied"); addLog("ERROR", "Laptop location is not supported by this browser."); return; }
    setLocationState("locating");
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setNodes((current) => {
        const existing = current.find((node) => node.id === "MASTER");
        const master: NodeUnit = { ...existing, id: "MASTER", label: "Master · Command laptop", online: true, clients: existing?.clients ?? 0, lat: coords.latitude, lng: coords.longitude };
        return existing ? current.map((node) => node.id === "MASTER" ? master : node) : [master, ...current];
      });
      setLocationState("located");
      addLog("INFO", `Command laptop located · ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
    }, (error) => { setLocationState("denied"); addLog("ERROR", `Laptop location unavailable: ${error.message}`); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }, [addLog]);

  const applyLine = useCallback((line: string) => {
    const text = line.trim();
    if (!text) return;
    addLog("RX", text);
    let packet: Record<string, unknown> | null = null;
    try { const start = text.indexOf("{"); if (start >= 0) packet = JSON.parse(text.slice(start)) as Record<string, unknown>; } catch { packet = null; }

    if (packet) {
      const type = String(packet.type ?? "message").toLowerCase();
      const nodeId = String(packet.nodeId ?? packet.node_id ?? "MASTER");
      if (["telemetry", "node", "heartbeat"].includes(type)) {
        const next: NodeUnit = { id: nodeId, label: String(packet.label ?? nodeId), online: true, lat: numberOrUndefined(packet.lat), lng: numberOrUndefined(packet.lng ?? packet.lon), battery: numberOrUndefined(packet.battery), rssi: numberOrUndefined(packet.rssi), clients: numberOrUndefined(packet.clients) };
        setNodes((current) => current.some((node) => node.id === nodeId) ? current.map((node) => node.id === nodeId ? { ...node, ...next, lat: next.lat ?? node.lat, lng: next.lng ?? node.lng, battery: next.battery ?? node.battery, rssi: next.rssi ?? node.rssi, clients: next.clients ?? node.clients } : node) : [next, ...current]);
        return;
      }
      if (["user", "member", "location", "message", "sos"].includes(type)) {
        const id = String(packet.userId ?? packet.user_id ?? packet.id ?? `USR-${Date.now()}`);
        const priority: Priority = type === "sos" || String(packet.priority ?? "").toLowerCase() === "critical" ? "critical" : "normal";
        const messageText = String(packet.message ?? packet.text ?? "");
        const lat = numberOrUndefined(packet.lat);
        const lng = numberOrUndefined(packet.lng ?? packet.lon);
        upsertPerson({ id, name: String(packet.name ?? `Survivor ${id.slice(-4)}`), nodeId, priority, lastMessage: messageText, lastSeen: timeNow(), lat, lng, online: true, locationKind: lat !== undefined && lng !== undefined ? "exact" : undefined });
        if (messageText && ["message", "sos"].includes(type)) {
          setMessages((current) => [...current, { id: `MSG-${Date.now()}-${Math.random()}`, userId: id, direction: "incoming", text: messageText, at: timeNow(), priority }]);
          setSelectedId(id);
        }
        return;
      }
      return;
    }

    const legacy = text.match(/^(PHONE|RELAY):\s*(.+)$/i);
    if (legacy) {
      const id = "LEGACY-PHONE";
      const at = timeNow();
      upsertPerson({ id, name: "Unidentified phone", nodeId: "MASTER", priority: "normal", lastMessage: legacy[2], lastSeen: at, online: true });
      setMessages((current) => [...current, { id: `MSG-${Date.now()}`, userId: id, direction: "incoming", text: legacy[2], at, priority: "normal" }]);
      setSelectedId(id);
    }
  }, [addLog, upsertPerson]);

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
    } catch (error) { if (keepReadingRef.current) addLog("ERROR", `Serial connection lost: ${(error as Error).message}`); }
    finally {
      try { reader.releaseLock(); } catch { setConnected(false); }
      readerRef.current = null;
      if (keepReadingRef.current) { keepReadingRef.current = false; portRef.current = null; setConnected(false); }
    }
  }, [addLog, applyLine]);

  const connectSerial = async () => {
    const serial = (navigator as SerialNavigator).serial;
    if (!serial) { addLog("ERROR", "Web Serial requires Chrome or Edge over HTTPS."); return; }
    setConnecting(true);
    try {
      const port = await serial.requestPort();
      await port.open({ baudRate: 115200 });
      portRef.current = port;
      keepReadingRef.current = true;
      setConnected(true);
      addLog("INFO", "ESP32 connected at 115200 baud");
      locateMaster();
      const task = readSerial(port);
      readTaskRef.current = task;
      void task.finally(() => { readTaskRef.current = null; });
    } catch (error) { setConnected(false); if ((error as Error).name !== "NotFoundError") addLog("ERROR", `Could not connect: ${(error as Error).message}`); }
    finally { setConnecting(false); }
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

  const openConversation = (id: string) => { if (!id.startsWith("UNREGISTERED")) { setSelectedId(id); setView("people"); } };
  const sendReply = async () => {
    const message = reply.trim().replace(/\s*\n+\s*/g, " ");
    if (!message || !selected || !portRef.current?.writable) return;
    const command = JSON.stringify({ type: "command", to: selected.id, message });
    try {
      const writer = portRef.current.writable.getWriter();
      await writer.write(new TextEncoder().encode(`${command}\n`));
      writer.releaseLock();
      const at = timeNow();
      setMessages((current) => [...current, { id: `MSG-${Date.now()}`, userId: selected.id, direction: "outgoing", text: message, at, priority: "normal" }]);
      setPeople((current) => current.map((person) => person.id === selected.id ? { ...person, lastMessage: message, lastSeen: at } : person));
      setReply("");
      addLog("TX", command);
    } catch (error) { addLog("ERROR", `Send failed: ${(error as Error).message}`); }
  };

  return (
    <main className="app-shell">
      <header className="app-header glass">
        <div className="logo"><span>A</span><div><b>Aero-Node</b><small>Rescue command</small></div></div>
        <nav className="top-nav" aria-label="Dashboard sections">
          <button className={view === "map" ? "active" : ""} onClick={() => setView("map")}><span>⌖</span>Live map</button>
          <button className={view === "people" ? "active" : ""} onClick={() => setView("people")}><span>◌</span>Conversations{people.length > 0 && <i>{people.length}</i>}</button>
          <button className={view === "traffic" ? "active" : ""} onClick={() => setView("traffic")}><span>↕</span>Traffic</button>
        </nav>
        <div className={`connection-pill ${connected ? "online" : ""}`}><i />{connected ? "Gateway online" : "Gateway offline"}</div>
        <button className={`connect-button ${connected ? "disconnect" : ""}`} onClick={connected ? disconnect : connectSerial} disabled={connecting}>{connecting ? "Choose port…" : connected ? "Disconnect" : "Connect ESP32"}</button>
      </header>

      <section className="command-bar">
        <div><p>OPERATIONS / MASTER GATEWAY</p><h1>{view === "map" ? "Field overview" : view === "people" ? "Survivor conversations" : "Gateway traffic"}</h1><span>{view === "map" ? "Live positions for the command node and checked-in survivors." : view === "people" ? "One private conversation for every person who checks in." : "Raw USB activity for diagnostics and radio verification."}</span></div>
        <div className="quick-stats glass"><div><strong>{wifiUsers}</strong><small>Wi-Fi users</small></div><div><strong>{people.length}</strong><small>Checked in</small></div><div className={unreadCritical ? "danger" : ""}><strong>{unreadCritical}</strong><small>Critical</small></div></div>
      </section>

      {view === "map" && <section className="map-dashboard">
        <section className="map-card glass"><div className="card-heading"><div><small>LIVE OPERATIONS MAP</small><h2>People and nodes</h2></div><div className="map-actions"><span>{locatedNodes.length + mappedPeople.length} mapped</span><button onClick={locateMaster} disabled={locationState === "locating"}>{locationState === "located" ? "✓ Laptop located" : locationState === "locating" ? "Locating…" : "Use laptop location"}</button></div></div><div className="map-wrap"><CommandMap nodes={locatedNodes} people={mappedPeople} selectedId={selectedId ?? ""} onSelect={openConversation} />{locatedNodes.length + mappedPeople.length === 0 && <div className="map-empty glass"><Empty icon="⌖" title="No locations received" text="Connect the gateway and allow laptop location." /></div>}</div><p className="map-caption"><b>Location confidence:</b> checked-in users with shared GPS are exact. Connected devices without GPS are placed approximately near the master.</p></section>
        <aside className="roster-card glass"><div className="card-heading"><div><small>PEOPLE IN RANGE</small><h2>Recent check-ins</h2></div><span className="count-pill">{people.length}</span></div><div className="roster-list">{people.length === 0 ? <Empty icon="◌" title="No one checked in" text="A person appears here after opening the rescue portal." /> : people.map((person) => <button key={person.id} className="roster-person" onClick={() => openConversation(person.id)}><Avatar name={person.name} priority={person.priority} /><div><b>{person.name}</b><p>{person.lastMessage || "Connected to rescue portal"}</p><small>{person.lat !== undefined ? "Exact GPS shared" : "Mapped near master · approximate"} · {person.lastSeen}</small></div><span>→</span></button>)}</div>{placeholderCount > 0 && <div className="pending-devices"><span>⌁</span><div><b>{placeholderCount} connected {placeholderCount === 1 ? "device" : "devices"} not checked in</b><small>Ask them to open 192.168.4.1</small></div></div>}</aside>
      </section>}

      {view === "people" && <section className="conversation-shell glass">
        <aside className="conversation-list"><div className="conversation-list-head"><small>ACTIVE PEOPLE</small><h2>Conversations</h2><p>Each phone has an independent thread.</p></div><div className="conversation-scroll">{people.length === 0 ? <Empty icon="◌" title="No conversations" text="Incoming messages create a separate person here." /> : people.map((person) => <button key={person.id} className={selectedId === person.id ? "selected" : ""} onClick={() => setSelectedId(person.id)}><Avatar name={person.name} priority={person.priority} /><div><b>{person.name}</b><p>{person.lastMessage || "New connection"}</p><small>{person.id} · {person.lastSeen}</small></div>{person.priority === "critical" && <i>!</i>}</button>)}</div></aside>
        <section className="chat-window">{selected ? <><header className="chat-head"><div className="chat-person"><Avatar name={selected.name} priority={selected.priority} /><div><h2>{selected.name}</h2><p><i /> Connected through {selected.nodeId} · {selected.lat !== undefined ? "Exact GPS shared" : "Node-area location · approximate"}</p></div></div><button onClick={() => setView("map")}>⌖ Show on map</button></header><div className="message-window">{selectedMessages.length === 0 ? <Empty icon="✦" title="Connection established" text="Messages from this person will appear only in this thread." /> : selectedMessages.map((message) => <div key={message.id} className={`chat-row ${message.direction}`}><div><small>{message.direction === "incoming" ? selected.name : "Command"}</small><p>{message.text}</p><time>{message.at}</time></div></div>)}</div><footer className="composer"><textarea value={reply} maxLength={220} onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendReply(); } }} placeholder={connected ? `Reply privately to ${selected.name}…` : "Connect the ESP32 to reply"} disabled={!connected} /><button onClick={sendReply} disabled={!connected || !reply.trim()}>Send reply <span>→</span></button><small>{reply.length}/220 · sent only to {selected.name}</small></footer></> : <Empty icon="↗" title="Select a person" text="Choose a checked-in survivor to open their private conversation." />}</section>
      </section>}

      {view === "traffic" && <section className="traffic-panel glass"><header><div><small>SERIAL MONITOR</small><h2>Live gateway traffic</h2><p>USB ↔ ESP32 ↔ LoRa at 115200 baud</p></div><div className="traffic-legend"><span><i className="rx-dot" />Received</span><span><i className="tx-dot" />Sent</span><button onClick={() => setLogs([])}>Clear traffic</button></div></header><div className="traffic-table"><div className="traffic-row traffic-labels"><span>TIME</span><span>TYPE</span><span>SIZE</span><span>PACKET</span></div>{logs.length === 0 ? <Empty icon="↕" title="Traffic cleared" text="New serial packets will appear here." /> : logs.slice().reverse().map((log) => <div className="traffic-row" key={log.id}><time>{log.at}</time><b className={log.type.toLowerCase()}>{log.type}</b><em>{log.bytes > 0 ? `${log.bytes} B` : "—"}</em><p>{log.text}</p></div>)}</div></section>}
    </main>
  );
}

function Avatar({ name, priority }: { name: string; priority: Priority }) { return <span className={`avatar ${priority}`}>{name.trim().charAt(0).toUpperCase() || "?"}</span>; }
function Empty({ icon, title, text }: { icon: string; title: string; text: string }) { return <div className="empty-state"><span>{icon}</span><b>{title}</b><small>{text}</small></div>; }
