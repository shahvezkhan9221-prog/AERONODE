"use client";

import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";

type MapNode = { id: string; label: string; lat?: number; lng?: number; online: boolean; rssi?: number; battery?: number };
type MapPerson = { id: string; name: string; nodeId: string; lat?: number; lng?: number; priority: "critical" | "normal" };
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);

export default function CommandMap({ nodes, people, selectedId, onSelect }: {
  nodes: MapNode[];
  people: MapPerson[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, { zoomControl: false, attributionControl: true, minZoom: 3 }).setView([20.5937, 78.9629], 5);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      setReady(true);
    });
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || !layerRef.current) return;
    let active = true;
    import("leaflet").then((L) => {
      if (!active || !mapRef.current || !layerRef.current) return;
      layerRef.current.clearLayers();
      const points: [number, number][] = [];

      nodes.forEach((node) => {
        if (!Number.isFinite(node.lat) || !Number.isFinite(node.lng)) return;
        const position: [number, number] = [node.lat as number, node.lng as number];
        points.push(position);
        const details = [node.label, node.battery === undefined ? null : `${node.battery}%`, node.rssi === undefined ? null : `${node.rssi} dBm`].filter(Boolean).join(" · ");
        const icon = L.divIcon({ className: "custom-marker-wrap", html: `<div class="bright-node-marker"><span>⌁</span><b>${escapeHtml(node.id)}</b></div>`, iconSize: [56, 56], iconAnchor: [28, 28] });
        L.marker(position, { icon }).bindTooltip(details, { direction: "top", offset: [0, -20] }).addTo(layerRef.current);
      });

      people.forEach((person) => {
        if (!Number.isFinite(person.lat) || !Number.isFinite(person.lng)) return;
        const position: [number, number] = [person.lat as number, person.lng as number];
        points.push(position);
        const safeName = escapeHtml(person.name);
        const icon = L.divIcon({ className: "custom-marker-wrap", html: `<button class="bright-person-marker ${person.priority} ${person.id === selectedId ? "chosen" : ""}" aria-label="${safeName}"><i></i><span>${safeName}</span></button>`, iconSize: [110, 52], iconAnchor: [55, 26] });
        L.marker(position, { icon }).on("click", () => onSelect(person.id)).bindTooltip(`${person.nodeId} · ${person.id}`, { direction: "top", offset: [0, -16] }).addTo(layerRef.current);
      });

      if (points.length === 1) mapRef.current.setView(points[0], 16);
      if (points.length > 1) mapRef.current.fitBounds(points, { padding: [70, 70], maxZoom: 16 });
    });
    return () => { active = false; };
  }, [nodes, people, selectedId, onSelect, ready]);

  return <div ref={containerRef} className="map-canvas" aria-label="Map of live Aero-Node locations" />;
}
