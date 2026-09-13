import { db } from "@/db";
import { hazardEvents } from "@/db/schema";
import { desc } from "drizzle-orm";
import { fuse } from "./fusion";
import { predict } from "./ml";
import {
  HazardEvent,
  NodeData,
  Readings,
  Scenario,
  Snapshot,
  Source,
  Tier,
  highestHazard,
  tierRank,
} from "./types";

export interface DataSource {
  kind: Source;
  read(
    nodeId: string,
    progress: number,
    scenario: Scenario,
  ): { sensors: Readings; battery: number; timestamp: string } | null;
}
const definitions = [
  {
    id: "node-1",
    name: "Node 01",
    subtitle: "Earthquake & vibration",
    location: {
      lat: 27.6058,
      lng: 77.5934,
      name: "Academic Block · GLA Mathura",
    },
    keys: ["acceleration", "shock", "sound"],
  },
  {
    id: "node-2",
    name: "Node 02",
    subtitle: "Flood & landslide context",
    location: { lat: 27.6038, lng: 77.5979, name: "Hostel Zone · GLA Mathura" },
    keys: ["moisture", "float", "rain", "temperature", "pressure", "pir"],
  },
];
const noise = (base: number, amount: number) =>
  Math.round((base + (Math.random() - 0.5) * amount) * 100) / 100;
const simulation: DataSource = {
  kind: "simulation",
  read(id, progress, scenario) {
    const p = progress / 100;
    return {
      timestamp: new Date().toISOString(),
      battery: id === "node-1" ? 86 : 92,
      sensors:
        id === "node-1"
          ? {
              acceleration:
                scenario === "earthquake"
                  ? noise(0.025 + p * 1.1, 0.02)
                  : noise(0.025, 0.02),
              shock: scenario === "earthquake" && p > 0.48 ? 1 : 0,
              sound: scenario === "earthquake" && p > 0.78 ? 1 : 0,
            }
          : {
              moisture:
                scenario === "flood"
                  ? Math.min(94, noise(38 + p * 58, 1))
                  : noise(38, 1.4),
              float: scenario === "flood" && p > 0.5 ? 1 : 0,
              rain:
                scenario === "flood"
                  ? Math.min(98, noise(8 + p * 92, 2))
                  : noise(8, 2),
              temperature: noise(29.4 - p * 1.2, 0.3),
              pressure: noise(1008.6 - p * 2.4, 0.5),
              pir: Math.random() > 0.92 ? 1 : 0,
            },
    };
  },
};
type Packet = {
  nodeId: string;
  sensors: Readings;
  battery: number;
  timestamp: string;
  location?: { lat: number; lng: number };
  rssi?: number;
  snr?: number;
};
class Monitor {
  source: Source = "simulation";
  scenario: Scenario = "idle";
  started = 0;
  lastTick = 0;
  events: HazardEvent[] = [];
  nodes: NodeData[] = [];
  storageConnected = !!db;
  packets = new Map<string, Packet>();
  previous = new Map<string, string>();
  pending: Promise<Snapshot> | null = null;
  hardware: DataSource = {
    kind: "hardware",
    read: (id) => this.packets.get(id) ?? null,
  };
  setControl(source: Source, scenario: Scenario) {
    this.source = source;
    this.scenario = source === "hardware" ? "idle" : scenario;
    this.started = Date.now();
    this.lastTick = 0;
    this.nodes = [];
    this.previous.clear();
  }
  ingest(packet: Packet) {
    this.packets.set(packet.nodeId, packet);
  }
  setStorageConnected(connected: boolean) {
    this.storageConnected = connected;
  }
  async snapshot(): Promise<Snapshot> {
    if (this.pending) return this.pending;
    this.pending = this.update();
    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }
  async update(): Promise<Snapshot> {
    const now = Date.now();
    const progress =
      this.scenario === "idle" ? 0 : Math.min(100, (now - this.started) / 450);
    if (now - this.lastTick > 1500) {
      this.lastTick = now;
      const adapter = this.source === "simulation" ? simulation : this.hardware;
      this.nodes = definitions.map((def) => {
        const reading = adapter.read(def.id, progress, this.scenario);
        const online =
          !!reading &&
          now - new Date(reading.timestamp).getTime() < 12000 &&
          Object.values(reading.sensors).some((v) => v != null);
        const sensors: Readings = online
          ? reading!.sensors
          : Object.fromEntries(def.keys.map((k) => [k, null]));
        const prev = this.nodes.find((n) => n.id === def.id);
        const hazards = fuse(def.id, sensors);
        const history = [
          ...(prev?.history ?? []),
          {
            time: now,
            sensors,
            score: Math.max(...hazards.map((h) => h.score)),
          },
        ].slice(-150);
        // Advisory only: the model reads the same window the UI charts, and never changes a tier or an event.
        const ml = online
          ? predict(
              def.id,
              history,
              hazards.reduce(
                (worst, h) =>
                  tierRank[h.tier] > tierRank[worst] ? h.tier : worst,
                "Normal" as Tier,
              ),
            )
          : null;
        const packet = this.packets.get(def.id);
        return {
          ...def,
          location:
            this.source === "hardware" && packet?.location
              ? { ...def.location, ...packet.location }
              : def.location,
          battery: reading?.battery ?? 0,
          lastSeen: reading?.timestamp ?? "",
          online,
          locationSource:
            this.source === "hardware" && packet?.location ? "gps" : "seed",
          sensors,
          hazards,
          ml,
          history,
        };
      });
      for (const node of this.nodes) {
        if (!node.online) continue;
        for (const hazard of node.hazards) {
          const key = `${node.id}:${hazard.type}`;
          if (this.previous.get(key) === hazard.tier) continue;
          this.previous.set(key, hazard.tier);
          const event: HazardEvent = {
            id: crypto.randomUUID(),
            timestamp: new Date(now).toISOString(),
            nodeId: node.id,
            nodeName: node.name,
            hazard: hazard.type,
            tier: hazard.tier,
            score: hazard.score,
            contributors: hazard.contributors,
            explanation: hazard.explanation,
            location: node.location,
          };
          this.events = [event, ...this.events].slice(0, 200);
          if (db)
            try {
              await db
                .insert(hazardEvents)
                .values({ ...event, timestamp: new Date(event.timestamp) });
              this.storageConnected = true;
            } catch (error) {
              this.storageConnected = false;
              console.error(
                "Event persistence unavailable",
                error instanceof Error ? error.message : error,
              );
            }
        }
      }
    }
    return {
      type: "snapshot",
      source: this.source,
      timestamp: new Date(now).toISOString(),
      nodes: this.nodes,
      scenario: {
        name: this.scenario,
        progress: Math.round(progress),
        running: this.scenario !== "idle" && progress < 100,
      },
      events: this.events.slice(0, 30),
      storageConnected: this.storageConnected,
    };
  }
  async history() {
    if (!db) throw new Error("Supabase is not configured");
    const rows = await db
      .select()
      .from(hazardEvents)
      .orderBy(desc(hazardEvents.timestamp))
      .limit(500);
    return rows.map((r) => ({ ...r, timestamp: r.timestamp.toISOString() }));
  }
}
const globalMonitor = globalThis as typeof globalThis & {
  sentinelMonitor?: Monitor;
};
export const monitor = (globalMonitor.sentinelMonitor ??= new Monitor());
export { highestHazard };
