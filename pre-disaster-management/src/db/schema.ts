import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  real,
  index,
} from "drizzle-orm/pg-core";
import type { Readings } from "@/lib/types";
export const hazardEvents = pgTable("hazard_events", {
  id: text("id").primaryKey(),
  timestamp: timestamp("timestamp", { withTimezone: true })
    .notNull()
    .defaultNow(),
  nodeId: text("node_id").notNull(),
  nodeName: text("node_name").notNull(),
  hazard: text("hazard").notNull(),
  tier: text("tier").notNull(),
  score: integer("score").notNull(),
  contributors: jsonb("contributors").$type<string[]>().notNull(),
  explanation: text("explanation").notNull(),
  location: jsonb("location").$type<{ lat: number; lng: number }>().notNull(),
});

/** Raw, immutable hardware packets. Predictions are deliberately not stored: they can be
 * reproduced from these readings and may change when a model is retrained. */
export const telemetrySamples = pgTable(
  "telemetry_samples",
  {
    id: text("id").primaryKey(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    nodeId: text("node_id").notNull(),
    battery: integer("battery").notNull(),
    sensors: jsonb("sensors").$type<Readings>().notNull(),
    location: jsonb("location").$type<{ lat: number; lng: number } | null>(),
    rssi: integer("rssi"),
    snr: real("snr"),
  },
  (table) => [
    index("telemetry_node_time_idx").on(table.nodeId, table.timestamp),
  ],
);
