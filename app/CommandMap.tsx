"use client";

import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";

type MapNode = { id: string; label: string; lat: number; lng: number; online: boolean; rssi: number; battery: number; people: number };
type MapPerson = { id: string; name: string; nodeId: string; lat: number; lng: number; status: "critical" | "warning" | "stable" };

export default function CommandMap({ nodes, people, selectedId, onSelect }: { nodes: MapNode[]; people: MapPerson[]; selectedId: string; onSelect: (id: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, { zoomControl: false, attributionControl: true, minZoom: 3 }).setView([23.0225, 72.5735], 15);
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
      if (!active || !layerRef.current) return;
      layerRef.current.clearLayers();
      nodes.forEach((node) => {
        const icon = L.divIcon({ className: "custom-marker-wrap", html: `<div class="map-node-marker ${node.online ? "" : "offline"}"><span>⌁</span><b>${node.id}</b></div>`, iconSize: [58, 58], iconAnchor: [29, 29] });
        L.marker([node.lat, node.lng], { icon }).bindTooltip(`${node.label} · ${node.battery}% · ${node.rssi} dBm`, { direction: "top", offset: [0, -22] }).addTo(layerRef.current);
      });
      people.forEach((person) => {
        const icon = L.divIcon({ className: "custom-marker-wrap", html: `<button class="map-person-marker ${person.status} ${person.id === selectedId ? "chosen" : ""}" aria-label="${person.name}"><i></i><span>${person.id}</span></button>`, iconSize: [74, 48], iconAnchor: [37, 24] });
        L.marker([person.lat, person.lng], { icon }).on("click", () => onSelect(person.id)).bindTooltip(person.name, { direction: "top", offset: [0, -15] }).addTo(layerRef.current);
      });
    });
    return () => { active = false; };
  }, [nodes, people, selectedId, onSelect, ready]);

  return <div ref={containerRef} className="map-canvas" aria-label="Live map of Aero-Nodes and connected people" />;
}
