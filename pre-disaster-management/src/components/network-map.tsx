"use client";
import { useEffect, useRef } from "react";
import type {
  Map as LeafletMap,
  Marker,
  Polyline,
  CircleMarker,
} from "leaflet";
import { NodeData, highestHazard } from "@/lib/types";
/** Map geometry follows the nodes rather than fixed coordinates, so the same component works for the
 * seeded GLA Mathura campus positions and for real hardware GPS fixes. */
const FALLBACK: [number, number] = [27.6048, 77.5956]; // GLA University campus centre
const midpoint = (nodes: NodeData[]): [number, number] =>
  nodes.length
    ? [
        nodes.reduce((s, n) => s + n.location.lat, 0) / nodes.length,
        nodes.reduce((s, n) => s + n.location.lng, 0) / nodes.length,
      ]
    : FALLBACK;
/** Coarse key used to detect a real relocation (roughly 10 m) without re-fitting on every tick. */
const placeKey = (nodes: NodeData[]) =>
  nodes
    .map((n) => `${n.location.lat.toFixed(4)},${n.location.lng.toFixed(4)}`)
    .join("|");
const markerHtml = (n: NodeData, tier: string) =>
  `<div class="map-node tier-${tier}"><span class="map-node-core">${n.id === "node-1" ? "01" : "02"}</span><span class="map-node-label">${n.name}</span></div>`;

export default function NetworkMap({
  nodes,
  onSelect,
  large = false,
}: {
  nodes: NodeData[];
  onSelect: (id: string) => void;
  large?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef<Record<string, Marker>>({});
  const link = useRef<Polyline | null>(null);
  const gateway = useRef<CircleMarker | null>(null);
  const fitted = useRef("");
  const selection = useRef(onSelect);
  const latest = useRef(nodes);
  selection.current = onSelect;
  latest.current = nodes;
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !element.current) return;
      const initial = latest.current;
      const m = L.map(element.current, {
        zoomControl: false,
        scrollWheelZoom: false,
      }).setView(midpoint(initial), 12);
      map.current = m;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(m);
      L.control.zoom({ position: "bottomright" }).addTo(m);
      link.current = L.polyline(
        initial.map(
          (n) => [n.location.lat, n.location.lng] as [number, number],
        ),
        { color: "#729487", weight: 1.5, dashArray: "5 7", opacity: 0.6 },
      ).addTo(m);
      gateway.current = L.circleMarker(midpoint(initial), {
        radius: 6,
        color: "#fff",
        weight: 3,
        fillColor: "#53665e",
        fillOpacity: 1,
      })
        .addTo(m)
        .bindTooltip("Laptop · direct USB monitoring station");
      initial.forEach((n) => {
        markers.current[n.id] = L.marker([n.location.lat, n.location.lng], {
          icon: L.divIcon({
            className: "custom-map-marker",
            html: markerHtml(n, highestHazard(n).tier.toLowerCase()),
            iconSize: [42, 42],
            iconAnchor: [21, 21],
          }),
        })
          .addTo(m)
          .on("click", () => selection.current(n.id));
      });
      setTimeout(() => {
        if (!cancelled) m.invalidateSize();
      }, 150);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      markers.current = {};
      link.current = null;
      gateway.current = null;
      fitted.current = "";
    };
  }, []);
  useEffect(() => {
    import("leaflet").then((L) => {
      const m = map.current;
      if (!m || !nodes.length) return;
      nodes.forEach((n) => {
        const marker = markers.current[n.id];
        if (!marker) return;
        marker.setLatLng([n.location.lat, n.location.lng]);
        const el = marker.getElement()?.querySelector(".map-node");
        if (el)
          el.className = `map-node tier-${n.online ? highestHazard(n).tier.toLowerCase() : "offline"}`;
        if (!marker.getElement())
          marker.setIcon(
            L.divIcon({
              className: "custom-map-marker",
              html: markerHtml(n, "normal"),
              iconSize: [42, 42],
            }),
          );
      });
      link.current?.setLatLngs(
        nodes.map((n) => [n.location.lat, n.location.lng] as [number, number]),
      );
      gateway.current?.setLatLng(midpoint(nodes));
      // Re-frame only when the nodes actually move, which in practice means a hardware GPS fix arriving.
      const key = placeKey(nodes);
      if (key !== fitted.current) {
        fitted.current = key;
        m.fitBounds(
          nodes.map(
            (n) => [n.location.lat, n.location.lng] as [number, number],
          ),
          { padding: [60, 60], maxZoom: 16 },
        );
      }
    });
  }, [nodes]);
  return (
    <div
      className={`network-map ${large ? "large-map" : ""}`}
      ref={element}
      aria-label="Interactive sensor node map"
    />
  );
}
