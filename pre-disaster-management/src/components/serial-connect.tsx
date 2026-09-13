"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Check,
  Cable,
  CircleAlert,
  LoaderCircle,
  PlugZap,
  Unplug,
} from "lucide-react";

type NodeId = "node-1" | "node-2";
type PortStatus = "idle" | "choosing" | "connected" | "streaming" | "error";
type SerialReader = ReadableStreamDefaultReader<Uint8Array>;
type BrowserSerialPort = {
  readable: ReadableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
};
type BrowserSerial = { requestPort(): Promise<BrowserSerialPort> };

const nodeInfo: Record<NodeId, { name: string; subtitle: string }> = {
  "node-1": { name: "Node 01", subtitle: "Earthquake sensors" },
  "node-2": { name: "Node 02", subtitle: "Flood sensors" },
};

export default function SerialConnect({
  onActivateHardware,
}: {
  onActivateHardware: () => Promise<void>;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [statuses, setStatuses] = useState<Record<NodeId, PortStatus>>({
    "node-1": "idle",
    "node-2": "idle",
  });
  const [messages, setMessages] = useState<Record<NodeId, string>>({
    "node-1": "Select the USB port for the seismic ESP32.",
    "node-2": "Select the USB port for the flood ESP32.",
  });
  const [lastPackets, setLastPackets] = useState<Record<NodeId, string>>({
    "node-1": "",
    "node-2": "",
  });
  const ports = useRef<Partial<Record<NodeId, BrowserSerialPort>>>({});
  const readers = useRef<Partial<Record<NodeId, SerialReader>>>({});
  const readTasks = useRef<Partial<Record<NodeId, Promise<void>>>>({});

  useEffect(() => {
    setSupported("serial" in navigator);
    return () => {
      for (const reader of Object.values(readers.current)) void reader.cancel();
    };
  }, []);

  function update(nodeId: NodeId, status: PortStatus, message: string) {
    setStatuses((current) => ({ ...current, [nodeId]: status }));
    setMessages((current) => ({ ...current, [nodeId]: message }));
  }

  async function forwardLine(nodeId: NodeId, line: string) {
    let packet: Record<string, unknown>;
    try {
      packet = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // Ignore ESP32 boot messages and library diagnostics.
    }
    if (packet.nodeId !== nodeId) {
      update(
        nodeId,
        "error",
        `Wrong device: this port reports ${String(packet.nodeId ?? "no nodeId")}.`,
      );
      return;
    }
    packet.timestamp = new Date().toISOString();
    const response = await fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(packet),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok)
      throw new Error(result.error ?? "Website rejected packet");
    setLastPackets((current) => ({
      ...current,
      [nodeId]: new Date().toLocaleTimeString("en-GB"),
    }));
    update(nodeId, "streaming", "Live packets are reaching the dashboard.");
  }

  async function readPort(nodeId: NodeId, port: BrowserSerialPort) {
    if (!port.readable) throw new Error("The selected port is not readable.");
    const reader = port.readable.getReader();
    readers.current[nodeId] = reader;
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            await forwardLine(nodeId, line.trim());
          } catch (error) {
            update(
              nodeId,
              "error",
              error instanceof Error
                ? error.message
                : "Packet forwarding failed.",
            );
          }
        }
      }
    } catch (error) {
      if (readers.current[nodeId] === reader)
        update(
          nodeId,
          "error",
          error instanceof Error ? error.message : "Serial connection stopped.",
        );
    } finally {
      reader.releaseLock();
      delete readers.current[nodeId];
    }
  }

  async function connect(nodeId: NodeId) {
    const serial = (navigator as Navigator & { serial?: BrowserSerial }).serial;
    if (!serial) return;
    update(
      nodeId,
      "choosing",
      "Choose the correct ESP32 in the browser prompt.",
    );
    try {
      const port = await serial.requestPort();
      await port.open({ baudRate: 115200 });
      ports.current[nodeId] = port;
      update(
        nodeId,
        "connected",
        "Port opened. Waiting for the first JSON packet…",
      );
      await onActivateHardware();
      const task = readPort(nodeId, port);
      readTasks.current[nodeId] = task;
      void task.finally(() => delete readTasks.current[nodeId]);
    } catch (error) {
      update(
        nodeId,
        "error",
        error instanceof Error && error.name === "NotFoundError"
          ? "Port selection was cancelled."
          : error instanceof Error
            ? error.message
            : "Could not open this port.",
      );
    }
  }

  async function disconnect(nodeId: NodeId) {
    const reader = readers.current[nodeId];
    const port = ports.current[nodeId];
    try {
      if (reader) await reader.cancel();
      if (readTasks.current[nodeId]) await readTasks.current[nodeId];
      if (port) await port.close();
    } catch {
      // A physically removed USB device may already be closed.
    }
    delete ports.current[nodeId];
    update(
      nodeId,
      "idle",
      `Disconnected. Select ${nodeInfo[nodeId].name}'s USB port.`,
    );
  }

  return (
    <section
      className="serial-connect neo"
      aria-labelledby="serial-connect-title"
    >
      <div className="serial-connect-heading">
        <span className="serial-connect-icon">
          <PlugZap size={22} />
        </span>
        <div>
          <span className="eyebrow">DIRECT USB / TWO ESP32 BOARDS</span>
          <h2 id="serial-connect-title">Connect sensor ports</h2>
          <p>
            Plug in both boards, then assign one browser-approved port to each
            node. Data starts flowing automatically.
          </p>
        </div>
        <span className="serial-secure">
          <Check size={12} /> Local permission only
        </span>
      </div>

      {supported === false ? (
        <div className="serial-unsupported" role="alert">
          <CircleAlert size={18} />
          <span>
            Direct serial access is unavailable in this browser. Open the site
            in desktop Chrome or Edge on <code>localhost</code>.
          </span>
        </div>
      ) : (
        <div className="serial-port-grid">
          {(Object.keys(nodeInfo) as NodeId[]).map((nodeId) => {
            const status = statuses[nodeId];
            const active = status === "connected" || status === "streaming";
            return (
              <article
                key={nodeId}
                className={`serial-port-card ${active ? "active" : ""}`}
              >
                <div className="serial-port-title">
                  <span className="serial-port-number">
                    {nodeId === "node-1" ? "01" : "02"}
                  </span>
                  <span>
                    <strong>{nodeInfo[nodeId].name}</strong>
                    <small>{nodeInfo[nodeId].subtitle}</small>
                  </span>
                  <i
                    className={`status-dot ${status === "streaming" ? "" : "offline"}`}
                  />
                </div>
                <p>{messages[nodeId]}</p>
                <div className="serial-port-actions">
                  {active ? (
                    <button
                      className="button secondary small"
                      onClick={() => void disconnect(nodeId)}
                    >
                      <Unplug size={14} /> Disconnect
                    </button>
                  ) : (
                    <button
                      className="button primary small"
                      disabled={status === "choosing" || supported == null}
                      onClick={() => void connect(nodeId)}
                    >
                      {status === "choosing" ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <Cable size={14} />
                      )}
                      {status === "choosing" ? "Choose port…" : "Connect port"}
                    </button>
                  )}
                  <span>
                    {lastPackets[nodeId]
                      ? `Last packet ${lastPackets[nodeId]}`
                      : "115200 baud"}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <div className="serial-connect-foot">
        <Activity size={14} /> Browser permission is requested only when you
        click a button. Close Arduino Serial Monitor before connecting.
      </div>
    </section>
  );
}
