"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Activity,
  ArrowDownToLine,
  BrainCircuit,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cpu,
  ExternalLink,
  FlaskConical,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  MapPin,
  Maximize2,
  Network,
  Play,
  Radio,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Waves,
  Wifi,
  X,
  Zap,
  Info,
  AlertTriangle,
  Cable,
  CircleDot,
  CalendarDays,
  Footprints,
} from "lucide-react";
import Brand from "./brand";
import NodeCard, { AnimatedNumber, Badge, SensorRow } from "./node-card";
import EventTable, { timeLabel } from "./event-table";
import { MlPanel, ModelCard, ModelIntro } from "./ml-panel";
import LiveTelemetry from "./live-telemetry";
import SerialConnect from "./serial-connect";
import {
  HazardEvent,
  NodeData,
  Scenario,
  SensorKey,
  Snapshot,
  Source,
  highestHazard,
  tierRank,
} from "@/lib/types";
const NetworkMap = dynamic(() => import("./network-map"), {
  ssr: false,
  loading: () => (
    <div className="map-loading">
      <LoaderCircle className="spin" size={22} /> Loading node map…
    </div>
  ),
});
type View =
  | "Overview"
  | "Sensor nodes"
  | "Live telemetry"
  | "Network map"
  | "Fusion engine"
  | "Model insight"
  | "Alerts & history"
  | "Settings";
const navigation = [
  { label: "Overview" as View, icon: LayoutDashboard },
  { label: "Sensor nodes" as View, icon: Radio },
  { label: "Live telemetry" as View, icon: Activity },
  { label: "Network map" as View, icon: MapPin },
  { label: "Fusion engine" as View, icon: Layers3 },
  { label: "Model insight" as View, icon: BrainCircuit },
  { label: "Alerts & history" as View, icon: Bell },
];
const caveats = [
  {
    title: "One direct flood signal",
    body: "The float switch is the only water-level sensor. Rainfall and soil moisture can corroborate context, but are not independent water-level backups.",
  },
  {
    title: "Short-demo soil probe",
    body: "The FC-28 / YL-69 resistive probe can corrode over prolonged deployment. Current calibration is suitable for demonstration, not long-term field operation.",
  },
  {
    title: "Threshold-only acoustics",
    body: "LM393 reports loud / not-loud comparator output. No calibrated sound pressure, frequency analysis, or clean analog waveform is available.",
  },
  {
    title: "Exposed-air prototypes",
    body: "Neither node has an enclosure or weatherproofing. No sustained-tilt or ground-displacement sensor is installed. Do not use this prototype for life-safety decisions.",
  },
];
export default function Dashboard() {
  const router = useRouter();
  const [view, setView] = useState<View>("Overview");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [scenario, setScenario] = useState<Scenario>("earthquake");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storedEvents, setStoredEvents] = useState<HazardEvent[]>([]);
  const [toast, setToast] = useState<HazardEvent | null>(null);
  const [sourceMenu, setSourceMenu] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [limitations, setLimitations] = useState(false);
  const [date, setDate] = useState("");
  const seen = useRef(new Set<string>());
  const [historyLoading, setHistoryLoading] = useState(false);
  useEffect(() => {
    setDate(
      new Date().toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
    );
    const stream = new EventSource("/api/stream");
    stream.onmessage = (event) => {
      const data: Snapshot = JSON.parse(event.data);
      setSnapshot(data);
      setConnected(true);
      const alert = data.events.find(
        (e) => !seen.current.has(e.id) && tierRank[e.tier] >= 2,
      );
      data.events.forEach((e) => seen.current.add(e.id));
      if (alert) setToast(alert);
    };
    stream.onerror = () => setConnected(false);
    return () => stream.close();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 9000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDemo(false);
        setSelected(null);
        setLimitations(false);
        setSourceMenu(false);
        setUserMenu(false);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const r = await fetch("/api/events");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setStoredEvents(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load history");
    } finally {
      setHistoryLoading(false);
    }
  }
  function changeView(next: View) {
    setView(next);
    if (next === "Alerts & history") void loadHistory();
  }
  async function control(source: Source, next: Scenario) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, scenario: next }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setSnapshot(data);
      setDemo(false);
      setSourceMenu(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update source");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/");
    router.refresh();
  }
  const nodes = snapshot?.nodes ?? [];
  const online = nodes.filter((n) => n.online).length;
  const activeAlerts = nodes.flatMap((n) =>
    n.online ? n.hazards.filter((h) => tierRank[h.tier] >= 2) : [],
  ).length;
  const networkRisk = nodes.length
    ? nodes
        .filter((n) => n.online)
        .reduce((max, n) => Math.max(max, highestHazard(n).score), 0)
    : 0;
  const currentNode = nodes.find((n) => n.id === selected);
  const isSimulation = snapshot?.source !== "hardware";
  const events = [
    ...new Map(
      [...(snapshot?.events ?? []), ...storedEvents].map((e) => [e.id, e]),
    ).values(),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const titles: Record<View, [string, string]> = {
    Overview: [
      "Network overview",
      "A live pulse on your environment. Every signal, in context.",
    ],
    "Sensor nodes": [
      "Sensor network",
      "Two independent nodes. Live physical readings in one connected view.",
    ],
    "Live telemetry": [
      "Live telemetry lab",
      "Continuous traces, packet tables, and a durable Supabase archive.",
    ],
    "Network map": [
      "Your network, on the ground",
      "GPS-tagged sensor nodes across the GLA University campus, Mathura.",
    ],
    "Fusion engine": [
      "Intelligence you can explain",
      "Independent signals. Transparent rules. Corroborated confidence.",
    ],
    "Model insight": [
      "What the model sees",
      "A trained second opinion on the same readings. Advisory, never the alert.",
    ],
    "Alerts & history": [
      "Alerts & event history",
      "A traceable record of every change in your network.",
    ],
    Settings: [
      "Workspace settings",
      "Data sources, hardware specifications, and prototype transparency.",
    ],
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand compact />
        <div className="workspace-label">MONITORING WORKSPACE</div>
        <nav>
          {navigation.map((item) => (
            <button
              key={item.label}
              onClick={() => changeView(item.label)}
              className={`nav-item ${view === item.label ? "active" : ""}`}
            >
              <item.icon size={18} strokeWidth={1.7} />
              <span>{item.label}</span>
              {item.label === "Sensor nodes" && <small>02</small>}
              {item.label === "Alerts & history" && activeAlerts > 0 && (
                <small className="alert-counter">{activeAlerts}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-divider" />
        <button className="nav-item" onClick={() => setDemo(true)}>
          <FlaskConical size={18} strokeWidth={1.7} />
          <span>Demo studio</span>
          <span className="demo-mini">DEMO</span>
        </button>
        <div className="sidebar-bottom">
          <div className="mesh-status">
            <span className="mesh-status-icon">
              <Network size={22} />
            </span>
            <strong>A resilient little network.</strong>
            <p>
              Independent nodes.
              <br />
              Collective intelligence.
            </p>
            <div>
              <i className={`status-dot ${connected ? "" : "offline"}`} />
              {connected
                ? isSimulation
                  ? "Simulation is connected"
                  : "Direct USB ports active"
                : "Connecting to network"}
            </div>
          </div>
          <button
            className={`nav-item ${view === "Settings" ? "active" : ""}`}
            onClick={() => changeView("Settings")}
          >
            <Settings2 size={18} />
            <span>Settings</span>
          </button>
          <button className="nav-item" onClick={() => setLimitations(true)}>
            <CircleHelp size={18} />
            <span>About this prototype</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-version">
            <span className="tiny-dot" /> SENTINEL-MESH <span>v1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>{view}</strong>
          </div>
          <div className="topbar-right">
            <span className="sih-badge">
              <ShieldCheck size={14} /> SIH 2026
            </span>
            <span className="topbar-separator" />
            <button
              className={`icon-button notification-button ${activeAlerts ? "has-alerts" : ""}`}
              aria-label="View notifications"
              onClick={() => changeView("Alerts & history")}
            >
              <Bell size={19} />
            </button>
            <div className="user-menu-wrap">
              <button
                className="user-button"
                onClick={() => setUserMenu(!userMenu)}
              >
                <span className="avatar">OP</span>
                <span>
                  Operator<small>Demo workspace</small>
                </span>
                <ChevronDown size={14} />
              </button>
              {userMenu && (
                <div className="popover user-popover">
                  <span>operator@sentinel.mesh</span>
                  <button onClick={logout}>
                    <LogOut size={16} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="dashboard-main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">SENTINEL-MESH / LIVE MONITORING</div>
              <h1>{titles[view][0]}</h1>
              <p>{titles[view][1]}</p>
            </div>
            <button className="button primary" onClick={() => setDemo(true)}>
              <Play size={15} fill="currentColor" /> Run simulation
            </button>
          </div>
          <div className="workspace-toolbar">
            <div className="source-control">
              <button
                className={`mode-button ${isSimulation ? "" : "hardware-mode"}`}
                onClick={() => setSourceMenu(!sourceMenu)}
              >
                <FlaskConical size={14} />
                {isSimulation ? "Simulation mode" : "Hardware mode"}
                <ChevronDown size={13} />
              </button>
              {sourceMenu && (
                <div className="popover source-popover">
                  <span>DATA SOURCE</span>
                  <button
                    disabled={busy}
                    onClick={() => control("simulation", "idle")}
                  >
                    <FlaskConical size={16} />
                    <span>
                      Simulation<small>Server-generated sensor telemetry</small>
                    </span>
                    {isSimulation && <Check size={15} />}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => control("hardware", "idle")}
                  >
                    <Cable size={16} />
                    <span>
                      Direct USB ports
                      <small>Two ESP32 boards · browser serial</small>
                    </span>
                    {!isSimulation && <Check size={15} />}
                  </button>
                </div>
              )}
              <span className="toolbar-note">
                {isSimulation
                  ? "Simulated data. Real fusion logic."
                  : "Real telemetry only. No simulated fallback."}
              </span>
            </div>
            <div className="live-label">
              <span className={`status-dot ${connected ? "" : "offline"}`} />
              {connected ? "Live" : "Reconnecting"}
              <span className="toolbar-divider" />
              <CalendarDays size={13} />
              {date}
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={16} />
              {error}
              <button className="icon-button" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {snapshot && !snapshot.storageConnected && (
            <div className="error-banner">
              Supabase persistence is unavailable. Live monitoring continues,
              but packets and event history are not being archived.
            </div>
          )}
          {snapshot?.scenario.name !== "idle" && snapshot && (
            <div className="scenario-banner">
              <FlaskConical size={17} />
              <div>
                <strong>
                  {snapshot.scenario.name === "earthquake"
                    ? "Approaching earthquake"
                    : "Rising flood"}
                </strong>
                <span>
                  {snapshot.scenario.running
                    ? "Scenario escalating over 45 seconds"
                    : "Scenario complete · peak readings held until reset"}
                </span>
              </div>
              <div className="scenario-progress">
                <span style={{ width: `${snapshot.scenario.progress}%` }} />
              </div>
              <b>{snapshot.scenario.progress}%</b>
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => control("simulation", "idle")}
              >
                <RotateCcw size={13} /> Reset
              </button>
            </div>
          )}
          {!snapshot ? (
            <div className="dashboard-loading">
              <div className="login-icon">
                <Radio size={30} className="pulse" />
              </div>
              <h2>Connecting to your network</h2>
              <p>Starting live telemetry and the fusion engine…</p>
            </div>
          ) : (
            <div key={view} className="view-content">
              {view === "Overview" && (
                <>
                  <SerialConnect
                    onActivateHardware={() => control("hardware", "idle")}
                  />
                  <div className="stats-grid">
                    <div className="stat-card neo">
                      <div className="stat-top">
                        <span>Network status</span>
                        <ShieldCheck size={18} />
                      </div>
                      <div
                        className={`stat-status ${activeAlerts ? "text-amber" : ""}`}
                      >
                        <span
                          className={`status-dot ${online !== nodes.length ? "offline" : ""}`}
                        />
                        {online !== nodes.length
                          ? "Awaiting data"
                          : activeAlerts
                            ? "Attention needed"
                            : "All systems normal"}
                      </div>
                      <div className="stat-foot">
                        {online === nodes.length
                          ? "Your network is looking healthy"
                          : "Connect both ESP32 ports above"}
                      </div>
                    </div>
                    <div className="stat-card neo">
                      <div className="stat-top">
                        <span>Nodes online</span>
                        <Radio size={18} />
                      </div>
                      <div className="stat-number">
                        {String(online).padStart(2, "0")}
                        <span> / {String(nodes.length).padStart(2, "0")}</span>
                        <span className="stat-chip">
                          {online === nodes.length
                            ? "All connected"
                            : "Check USB ports"}
                        </span>
                      </div>
                      <div className="stat-foot">
                        <span className="tiny-dot" /> USB serial · 115200 baud
                      </div>
                    </div>
                    <div className="stat-card neo">
                      <div className="stat-top">
                        <span>Active alerts</span>
                        <Bell size={18} />
                      </div>
                      <div className="stat-number">
                        {String(activeAlerts).padStart(2, "0")}
                        <span className="subtle-graph">
                          <Activity size={50} strokeWidth={1} />
                        </span>
                      </div>
                      <div className="stat-foot">
                        {activeAlerts
                          ? "Corroborated warnings need review"
                          : "No warning or critical events"}
                      </div>
                    </div>
                    <div className="stat-card neo">
                      <div className="stat-top">
                        <span>Network risk</span>
                        <Layers3 size={18} />
                      </div>
                      <div className="stat-number">
                        <AnimatedNumber value={networkRisk} />
                        <span>%</span>
                        <span
                          className={`risk-label ${networkRisk >= 60 ? "text-amber" : ""}`}
                        >
                          {online === 0
                            ? "No data"
                            : networkRisk < 30
                              ? "Low risk"
                              : networkRisk < 60
                                ? "Watch"
                                : "Elevated"}
                        </span>
                      </div>
                      <div className="stat-foot">
                        Highest node confidence · rule-based
                      </div>
                    </div>
                  </div>
                  <div className="overview-grid">
                    <section className="nodes-section">
                      <SectionHeading title="Sensor network" count="02 NODES">
                        <button onClick={() => changeView("Sensor nodes")}>
                          View all <ArrowUpRight size={14} />
                        </button>
                      </SectionHeading>
                      <div className="node-grid">
                        {nodes.map((n) => (
                          <NodeCard
                            node={n}
                            key={n.id}
                            onSelect={setSelected}
                          />
                        ))}
                      </div>
                    </section>
                    <section className="map-section">
                      <SectionHeading title="Network map">
                        <span className="section-location">
                          <MapPin size={12} /> GLA University, Mathura
                        </span>
                      </SectionHeading>
                      <div className="map-card neo">
                        <div className="map-card-header">
                          <span>
                            <span className="status-dot" />
                            {online} nodes connected
                          </span>
                          <button
                            className="icon-button"
                            aria-label="Expand map"
                            onClick={() => changeView("Network map")}
                          >
                            <Maximize2 size={15} />
                          </button>
                        </div>
                        <NetworkMap nodes={nodes} onSelect={setSelected} />
                        <div className="map-legend">
                          <span>
                            <i className="legend-dot green" />
                            Normal
                          </span>
                          <span>
                            <i className="legend-dot amber" />
                            Watch
                          </span>
                          <span>
                            <i className="legend-dot orange" />
                            Warning
                          </span>
                          <span>
                            <i className="legend-dot red" />
                            Critical
                          </span>
                        </div>
                        <div className="map-card-footer">
                          <MapPin size={15} />
                          <span>
                            GPS-tagged. Locally aware.
                            <small>
                              Seeded demo positions · NEO-6M shared GPS
                            </small>
                          </span>
                          <ArrowUpRight size={15} />
                        </div>
                      </div>
                    </section>
                    <section>
                      <SectionHeading title="Fusion intelligence">
                        <span className="explainable-label">
                          <Sparkles size={12} /> EXPLAINABLE BY DESIGN
                        </span>
                      </SectionHeading>
                      <div className="fusion-overview neo">
                        <div className="fusion-overview-top">
                          <div className="fusion-symbol">
                            <Layers3 size={23} />
                          </div>
                          <div>
                            <h3>
                              One signal is a hint. Together, they’re evidence.
                            </h3>
                            <p>
                              Independent readings cross-checked before an alert
                              is raised.
                            </p>
                          </div>
                        </div>
                        <div className="fusion-pipeline">
                          <span>
                            <Activity size={16} /> Sensor signals
                          </span>
                          <div className="pipeline-line" />
                          <span>
                            <Layers3 size={16} /> Fusion rules
                          </span>
                          <div className="pipeline-line" />
                          <span className="pipeline-result">
                            <ShieldCheck size={16} /> Trusted alerts
                          </span>
                        </div>
                        <div className="fusion-bottom">
                          <span>
                            <span className="status-dot" />
                            Rule-based multi-signal fusion{" "}
                            <span className="muted">
                              · Not a trained ML model
                            </span>
                          </span>
                          <button onClick={() => changeView("Fusion engine")}>
                            Explore logic <ArrowRight size={14} />
                          </button>
                        </div>
                      </div>
                    </section>
                    <section>
                      <SectionHeading title="Recent events">
                        <button onClick={() => changeView("Alerts & history")}>
                          View history <ArrowUpRight size={14} />
                        </button>
                      </SectionHeading>
                      <div className="recent-events neo">
                        <EventTable
                          events={events}
                          compact
                          onSelect={setSelected}
                        />
                      </div>
                    </section>
                  </div>
                  <div className="prototype-strip">
                    <Info size={17} />
                    <span>
                      <strong>Built for transparency.</strong> This is an
                      exposed-air hardware prototype with known sensing
                      limitations.
                    </span>
                    <button onClick={() => setLimitations(true)}>
                      View limitations <ArrowUpRight size={14} />
                    </button>
                  </div>
                </>
              )}
              {view === "Sensor nodes" && (
                <>
                  <div className="section-intro">
                    <span className="status-dot" /> {online} of {nodes.length}{" "}
                    nodes online{" "}
                    <span className="muted">
                      · ESP32 WROOM-32 · direct USB serial
                    </span>
                  </div>
                  <div className="expanded-node-grid">
                    {nodes.map((n) => (
                      <NodeCard key={n.id} node={n} onSelect={setSelected} />
                    ))}
                  </div>
                  <div className="prototype-strip">
                    <Footprints size={17} />
                    <span>
                      BMP280 and optional PIR are context signals — neither can
                      raise a flood alert.
                    </span>
                    <button onClick={() => setLimitations(true)}>
                      Hardware notes <ArrowRight size={14} />
                    </button>
                  </div>
                </>
              )}
              {view === "Live telemetry" && (
                <LiveTelemetry
                  nodes={nodes}
                  storageConnected={snapshot.storageConnected}
                />
              )}
              {view === "Network map" && (
                <div className="neo full-map-panel">
                  <div className="map-card-header">
                    <span>
                      <span className="status-dot" />
                      {online} nodes online ·{" "}
                      {nodes.some((n) => n.locationSource === "gps")
                        ? "Live hardware GPS"
                        : "GLA University campus, Mathura"}
                    </span>
                    <span className="muted">
                      Click a node to inspect live readings
                    </span>
                  </div>
                  <NetworkMap nodes={nodes} onSelect={setSelected} large />
                  <div className="map-node-list">
                    {nodes.map((n) => (
                      <button key={n.id} onClick={() => setSelected(n.id)}>
                        <MapPin size={19} />
                        <span>
                          <strong>
                            {n.name} · {n.subtitle}
                          </strong>
                          <small>
                            {n.location.lat.toFixed(4)}° N,{" "}
                            {n.location.lng.toFixed(4)}° E · {n.location.name}
                          </small>
                        </span>
                        <Badge
                          tier={n.online ? highestHazard(n).tier : "Offline"}
                        />
                        <ArrowUpRight size={15} />
                      </button>
                    ))}
                  </div>
                  <p className="map-note">
                    Dashed lines show conceptual node relationships, not
                    physical cable paths. Initial node positions are seeded for
                    the demo; hardware GPS packets update node positions.
                  </p>
                </div>
              )}
              {view === "Fusion engine" && (
                <>
                  <div className="fusion-principle neo">
                    <div className="login-icon">
                      <Layers3 size={28} />
                    </div>
                    <div>
                      <span className="eyebrow">
                        CORROBORATION, NOT GUESSWORK
                      </span>
                      <h2>Every warning needs more than one signal.</h2>
                      <p>
                        Confidence is a deterministic evidence score, not a
                        calibrated probability. The engine evaluates each hazard
                        independently. PIR never enters the calculation.
                      </p>
                    </div>
                    <span className="rule-version">RULESET v1.0</span>
                  </div>
                  <div className="fusion-hazard-grid">
                    {nodes.flatMap((n) =>
                      n.hazards.map((h) => (
                        <div key={h.type} className="neo fusion-hazard-card">
                          <div className="section-heading">
                            <h3>{h.type} detection</h3>
                            <Badge tier={n.online ? h.tier : "Offline"} />
                          </div>
                          <div className="fusion-large-score">
                            {n.online ? h.score : "—"}
                            <span>%</span>
                            <small>
                              {n.name} · {h.contributors.length}/{h.total}{" "}
                              corroborating
                            </small>
                          </div>
                          <p>
                            {n.online
                              ? h.explanation
                              : "Node offline. No current confidence assessment is available."}
                          </p>
                          <div className="contributor-list">
                            {h.contributors.length ? (
                              h.contributors.map((c) => (
                                <span key={c}>
                                  <Check size={14} />
                                  {c}
                                </span>
                              ))
                            ) : (
                              <span>
                                <CircleDot size={14} />
                                No active hazard evidence
                              </span>
                            )}
                          </div>
                          <button
                            className="text-button"
                            onClick={() => setSelected(n.id)}
                          >
                            Inspect sensor evidence <ArrowRight size={14} />
                          </button>
                        </div>
                      )),
                    )}
                  </div>
                  <RulesTable />
                  <div className="prototype-strip">
                    <Info size={17} />
                    <span>
                      Acceleration is gravity-removed deviation in g. Rain is
                      pad wetness, not rainfall in mm/h. Thresholds are
                      demo-calibrated.
                    </span>
                  </div>
                </>
              )}
              {view === "Model insight" && (
                <>
                  <ModelIntro />
                  <div className="ml-node-grid">
                    {nodes.map((n) => (
                      <div key={n.id} className="neo ml-node-panel">
                        <div className="section-heading">
                          <h3>
                            {n.name}
                            <span>{n.subtitle}</span>
                          </h3>
                          <Badge
                            tier={n.online ? highestHazard(n).tier : "Offline"}
                          />
                        </div>
                        <MlPanel node={n} />
                        <button
                          className="text-button"
                          onClick={() => setSelected(n.id)}
                        >
                          Inspect sensor evidence <ArrowRight size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <ModelCard />
                </>
              )}
              {view === "Alerts & history" && (
                <>
                  <div className="history-summary">
                    <span>
                      <Clock3 size={15} /> Tier changes are automatically
                      recorded with sensor evidence and GPS.
                    </span>
                    <button
                      className="button secondary small"
                      onClick={loadHistory}
                      disabled={historyLoading}
                    >
                      <RotateCcw
                        size={14}
                        className={historyLoading ? "spin" : ""}
                      />
                      {historyLoading ? "Loading…" : "Refresh history"}
                    </button>
                  </div>
                  <EventTable events={events} onSelect={setSelected} />
                </>
              )}
              {view === "Settings" && (
                <div className="settings-grid">
                  <section className="neo settings-panel">
                    <div className="section-heading">
                      <h2>Data source</h2>
                      <Radio size={20} />
                    </div>
                    <p>
                      The frontend consumes the same snapshot contract in both
                      modes. The server owns simulation and fusion.
                    </p>
                    <button
                      className={`source-option ${isSimulation ? "selected" : ""}`}
                      disabled={busy}
                      onClick={() => control("simulation", "idle")}
                    >
                      <FlaskConical size={23} />
                      <span>
                        <strong>Simulation</strong>
                        <small>Plausible values streamed every 2 seconds</small>
                      </span>
                      {isSimulation && <Check size={18} />}
                    </button>
                    <button
                      className={`source-option ${!isSimulation ? "selected" : ""}`}
                      disabled={busy}
                      onClick={() => control("hardware", "idle")}
                    >
                      <Cable size={23} />
                      <span>
                        <strong>Two direct USB ports</strong>
                        <small>
                          Browser-approved serial · 12s offline timeout
                        </small>
                      </span>
                      {!isSimulation && <Check size={18} />}
                    </button>
                    <div className="relay-doc">
                      <h3>Connecting both ESP32 boards</h3>
                      <p>
                        Open Overview and click <strong>Connect port</strong>{" "}
                        for Node 01, then Node 02. Choose the matching ESP32 in
                        each browser permission window. Both boards stream JSON
                        at 115200 baud directly into{" "}
                        <code>POST /api/ingest</code>.
                      </p>
                      <p>
                        Close Arduino Serial Monitor first. Direct USB requires
                        desktop Chrome or Edge and either HTTPS or localhost.
                      </p>
                    </div>
                  </section>
                  <section className="neo settings-panel">
                    <div className="section-heading">
                      <h2>Hardware manifest</h2>
                      <Cpu size={20} />
                    </div>
                    <div className="hardware-manifest">
                      <div>
                        <span>Microcontroller</span>
                        <strong>ESP32 DevKit · WROOM-32</strong>
                      </div>
                      <div>
                        <span>Primary link</span>
                        <strong>Two USB serial ports · 115200 baud</strong>
                      </div>
                      <div>
                        <span>Power</span>
                        <strong>TP4056 + 18650 battery</strong>
                      </div>
                      <div>
                        <span>Node 01 GPS</span>
                        <strong>u-blox NEO-6M · RX16 / TX18</strong>
                      </div>
                      <div>
                        <span>Node 02 context</span>
                        <strong>BMP280 · temperature + pressure</strong>
                      </div>
                      <div>
                        <span>Connection</span>
                        <strong>Each ESP32 connects directly to laptop</strong>
                      </div>
                      <div>
                        <span>Detection method</span>
                        <strong>Rule-based multi-signal fusion</strong>
                      </div>
                    </div>
                    <h3 className="settings-caveat-title">Honest by design</h3>
                    {caveats.map((c) => (
                      <div className="mini-caveat" key={c.title}>
                        <Info size={15} />
                        <div>
                          <strong>{c.title}</strong>
                          <p>{c.body}</p>
                        </div>
                      </div>
                    ))}
                  </section>
                </div>
              )}
            </div>
          )}
          <footer className="dashboard-footer">
            <span>
              <ShieldCheck size={13} /> Designed for early awareness. Built for
              resilience.
            </span>
            <span>
              SIH26178 <i /> Disaster Management <i /> Prototype v1.0
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div
          className={`alert-toast tier-${toast.tier.toLowerCase()}`}
          role="alert"
        >
          <span className="toast-icon">
            <AlertTriangle size={21} />
          </span>
          <div>
            <strong>
              {toast.tier}: {toast.hazard} · {toast.nodeName}
            </strong>
            <p>
              {toast.contributors.length} corroborating signals · {toast.score}%
              confidence
            </p>
            <button
              onClick={() => {
                setSelected(toast.nodeId);
                setToast(null);
              }}
            >
              Why this alert fired <ArrowRight size={13} />
            </button>
          </div>
          <button
            className="icon-button"
            aria-label="Dismiss alert"
            onClick={() => setToast(null)}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {demo && (
        <div className="modal-backdrop" onClick={() => setDemo(false)}>
          <section
            className="modal demo-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div className="login-icon">
                <FlaskConical size={26} />
              </div>
              <button
                className="icon-button"
                aria-label="Close simulation controls"
                onClick={() => setDemo(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="eyebrow">DEMO STUDIO</div>
            <h2 id="demo-title">Put the network to the test.</h2>
            <p>
              Watch real fusion rules turn independent signals into a
              corroborated warning. Each scenario ramps over 45 seconds.
            </p>
            <div className="scenario-options">
              {[
                {
                  id: "earthquake" as Scenario,
                  title: "Approaching earthquake",
                  text: "Acceleration rises → shock trips → acoustic corroboration",
                  icon: Activity,
                },
                {
                  id: "flood" as Scenario,
                  title: "Rising flood",
                  text: "Rain increases → float activates → soil saturates",
                  icon: Waves,
                },
              ].map((s) => (
                <button
                  key={s.id}
                  className={`scenario-option ${scenario === s.id ? "selected" : ""}`}
                  onClick={() => setScenario(s.id)}
                >
                  <s.icon size={24} />
                  <span>
                    <strong>{s.title}</strong>
                    <small>{s.text}</small>
                  </span>
                  <span className="radio-circle">
                    {scenario === s.id && <span />}
                  </span>
                </button>
              ))}
            </div>
            <div className="demo-note">
              <Info size={15} />
              Simulated sensor data only. No physical alerts are sent. Peak
              values hold until you reset to baseline.
            </div>
            <div className="modal-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => control("simulation", "idle")}
              >
                <RotateCcw size={15} /> Reset to baseline
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => control("simulation", scenario)}
              >
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Play size={15} />
                )}{" "}
                Start scenario
              </button>
            </div>
          </section>
        </div>
      )}
      {currentNode && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <aside
            className="node-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`${currentNode.name} live details`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-heading">
              <div>
                <span className="eyebrow">LIVE NODE INSPECTION</span>
                <h2>
                  {currentNode.name}
                  <span> / {currentNode.subtitle}</span>
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close node details"
                onClick={() => setSelected(null)}
              >
                <X size={21} />
              </button>
            </div>
            <div className="drawer-location">
              <MapPin size={15} />
              {currentNode.location.name} ·{" "}
              {currentNode.location.lat.toFixed(4)}° N,{" "}
              {currentNode.location.lng.toFixed(4)}° E
            </div>
            <div className="drawer-status">
              <Badge
                tier={
                  currentNode.online
                    ? highestHazard(currentNode).tier
                    : "Offline"
                }
              />
              <span>Battery {currentNode.battery}%</span>
              <span>
                Last seen{" "}
                {currentNode.lastSeen
                  ? timeLabel(currentNode.lastSeen)
                  : "Never"}
              </span>
            </div>
            <h3 className="drawer-section-title">Physical sensor readings</h3>
            <div className="drawer-sensors">
              {(Object.keys(currentNode.sensors) as SensorKey[])
                .filter((k) => k !== "pir")
                .map((k) => (
                  <SensorRow key={k} node={currentNode} sensorKey={k} />
                ))}
              {"pir" in currentNode.sensors && (
                <div className="drawer-pir">
                  <Footprints size={19} />
                  <span>
                    <strong>
                      PIR ·{" "}
                      {currentNode.sensors.pir == null
                        ? "No data"
                        : currentNode.sensors.pir
                          ? "Presence detected"
                          : "No presence"}
                    </strong>
                    <small>
                      Context signal — not used in flood risk score.
                    </small>
                  </span>
                  <span>{currentNode.sensors.pir ?? "—"}</span>
                </div>
              )}
            </div>
            <h3 className="drawer-section-title">
              Confidence over time{" "}
              <span>Last 5 minutes · since connection</span>
            </h3>
            <div className="history-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={currentNode.history.map((h) => ({
                    time: h.time,
                    score: h.score,
                  }))}
                >
                  <defs>
                    <linearGradient
                      id="scoreGradient"
                      x1="0"
                      x2="0"
                      y1="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#6d9680" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#6d9680" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 5"
                    vertical={false}
                    stroke="#dce2dc"
                  />
                  <XAxis
                    dataKey="time"
                    tickFormatter={(v) =>
                      new Date(v).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    }
                    tick={{ fontSize: 10, fill: "#7b847f" }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={40}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 10, fill: "#7b847f" }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    labelFormatter={(v) =>
                      timeLabel(new Date(Number(v)).toISOString())
                    }
                    formatter={(v) => [`${v}%`, "Confidence"]}
                    contentStyle={{
                      borderRadius: 12,
                      border: "none",
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="score"
                    stroke="#57816a"
                    strokeWidth={2}
                    fill="url(#scoreGradient)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <h3 className="drawer-section-title">
              Model assessment{" "}
              <span>
                Advisory · reads the last {currentNode.ml?.window ?? 20} samples
              </span>
            </h3>
            <MlPanel node={currentNode} />
            <h3 className="drawer-section-title">
              Why this tier? <span>Rule-based evidence breakdown</span>
            </h3>
            {currentNode.hazards.map((h) => (
              <div className="drawer-hazard" key={h.type}>
                <div>
                  <h3>{h.type}</h3>
                  <Badge tier={currentNode.online ? h.tier : "Offline"} />
                  <strong>{currentNode.online ? `${h.score}%` : "—"}</strong>
                </div>
                <p>
                  {currentNode.online
                    ? h.explanation
                    : "No fresh data. This node cannot be assessed until telemetry resumes."}
                </p>
                {h.contributors.map((c) => (
                  <span className="drawer-contributor" key={c}>
                    <Check size={14} />
                    {c}
                  </span>
                ))}
                <small>
                  {h.contributors.length}/{h.total} signals corroborating ·{" "}
                  {h.tier === "Normal"
                    ? "No alert raised"
                    : h.tier === "Watch"
                      ? "Single-signal watch; no warning raised"
                      : "Multi-signal warning rule met"}
                </small>
              </div>
            ))}
            <div className="demo-note">
              <Info size={16} />
              Prototype confidence is not a validated disaster probability.{" "}
              {currentNode.id === "node-1"
                ? "No sustained-tilt detection. Acoustic output is binary."
                : "One direct water-level sensor only. Soil probe has long-term corrosion risk."}
            </div>
          </aside>
        </div>
      )}
      {limitations && (
        <div className="modal-backdrop" onClick={() => setLimitations(false)}>
          <section
            className="modal limitations-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Prototype limitations"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div className="login-icon">
                <ShieldCheck size={27} />
              </div>
              <button
                className="icon-button"
                aria-label="Close prototype notes"
                onClick={() => setLimitations(false)}
              >
                <X size={20} />
              </button>
            </div>
            <span className="eyebrow">HONEST ENGINEERING</span>
            <h2>Know the network’s limits.</h2>
            <p>
              SENTINEL-MESH is an early-warning proof of concept for SIH26178,
              not a certified safety system.
            </p>
            {caveats.map((c, i) => (
              <div className="limitation-item" key={c.title}>
                <span>0{i + 1}</span>
                <div>
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                </div>
              </div>
            ))}
            <div className="demo-note">
              <Footprints size={17} />
              PIR detects nearby presence for demo context only. It never
              contributes to any hazard score.
            </div>
            <button
              className="button primary"
              onClick={() => setLimitations(false)}
            >
              Understood <Check size={16} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
function SectionHeading({
  title,
  count,
  children,
}: {
  title: string;
  count?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <h2>
        {title}
        {count && <span>{count}</span>}
      </h2>
      {children}
    </div>
  );
}
function RulesTable() {
  return (
    <section className="neo rules-panel">
      <div className="section-heading">
        <h2>The rules behind the score</h2>
        <span className="muted">
          <BookOpen size={14} /> src/lib/fusion.ts
        </span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Hazard</th>
              <th>Normal</th>
              <th>Watch · one signal</th>
              <th>Warning · corroborated</th>
              <th>Critical · corroborated peak</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Seismic</strong>
              </td>
              <td>
                No active signal
                <br />
                <small>8% baseline</small>
              </td>
              <td>
                Any 1 of acceleration ≥ 0.15 g, shock, or sound
                <br />
                <small>35%</small>
              </td>
              <td>
                Any 2 signals; or all 3 below 0.60 g<br />
                <small>68% / 78%</small>
              </td>
              <td>
                All 3 signals + acceleration ≥ 0.60 g<br />
                <small>92%</small>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Flood</strong>
              </td>
              <td>
                Float clear & rain &lt; 40%
                <br />
                <small>12% baseline</small>
              </td>
              <td>
                Float active OR rain ≥ 40%
                <br />
                <small>36%</small>
              </td>
              <td>
                Float active AND rain ≥ 40%
                <br />
                <small>72%</small>
              </td>
              <td>
                Float active + rain ≥ 75% + moisture ≥ 85%
                <br />
                <small>94%</small>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
