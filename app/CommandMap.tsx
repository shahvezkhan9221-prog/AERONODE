"use client";

import { useEffect, useRef, useState } from "react";

type MapNode = { id: string; label: string; lat?: number; lng?: number; online: boolean; rssi?: number; battery?: number };
type MapPerson = { id: string; name: string; nodeId: string; lat?: number; lng?: number; priority: "critical" | "normal"; locationKind?: "exact" | "approximate" };
type Position = { lat: number; lng: number };
type MapMouseEvent = { latLng?: { lat(): number; lng(): number } };
type Listener = { remove(): void };
type Bounds = { extend(position: Position): void };
type MapInstance = { fitBounds(bounds: Bounds, padding?: number): void; setCenter(position: Position): void; setZoom(zoom: number): void; setOptions(options: Record<string, unknown>): void; addListener(event: string, handler: (event: MapMouseEvent) => void): Listener };
type MarkerInstance = { setMap(map: MapInstance | null): void; addListener(event: string, handler: () => void): Listener };
type InfoWindowInstance = { setContent(content: Node): void; open(options: { anchor: MarkerInstance; map: MapInstance }): void; close(): void };
type GoogleMaps = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => MapInstance;
  Marker: new (options: Record<string, unknown>) => MarkerInstance;
  InfoWindow: new (options?: Record<string, unknown>) => InfoWindowInstance;
  LatLngBounds: new () => Bounds;
  Size: new (width: number, height: number) => unknown;
  Point: new (x: number, y: number) => unknown;
};
type GoogleWindow = Window & { google?: { maps: GoogleMaps } };

let mapsPromise: Promise<GoogleMaps> | null = null;

async function loadGoogleMaps() {
  const existing = (window as GoogleWindow).google?.maps;
  if (existing) return existing;
  if (mapsPromise) return mapsPromise;
  mapsPromise = fetch("/api/maps-config", { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error("Google Maps is not configured.");
    const config = await response.json() as { apiKey?: string };
    if (!config.apiKey) throw new Error("Google Maps API key is missing.");
    return new Promise<GoogleMaps>((resolve, reject) => {
      const callback = `aeroGoogleMapsReady${Date.now()}`;
      const callbackWindow = window as unknown as Record<string, unknown>;
      callbackWindow[callback] = () => {
        delete callbackWindow[callback];
        const maps = (window as GoogleWindow).google?.maps;
        if (maps) resolve(maps); else reject(new Error("Google Maps did not initialize."));
      };
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.apiKey)}&loading=async&callback=${callback}&v=weekly`;
      script.async = true;
      script.onerror = () => reject(new Error("Google Maps could not load."));
      document.head.append(script);
    });
  });
  return mapsPromise;
}

function flagIcon(maps: GoogleMaps, color: string, selected = false) {
  const canvas = document.createElement("canvas");
  const scale = window.devicePixelRatio > 1 ? 2 : 1;
  canvas.width = 58 * scale;
  canvas.height = 72 * scale;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.scale(scale, scale);
  context.shadowColor = "rgba(20,32,55,.28)";
  context.shadowBlur = selected ? 12 : 8;
  context.shadowOffsetY = 5;
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(27, 59, selected ? 8 : 6, 0, Math.PI * 2);
  context.fill();
  context.shadowColor = "transparent";
  context.strokeStyle = "#ffffff";
  context.lineWidth = selected ? 6 : 4;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(22, 58);
  context.lineTo(22, 14);
  context.stroke();
  context.strokeStyle = "#25334d";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(22, 59);
  context.lineTo(22, 13);
  context.stroke();
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(23, 14);
  context.quadraticCurveTo(38, 8, 50, 16);
  context.lineTo(45, 33);
  context.quadraticCurveTo(34, 26, 23, 31);
  context.closePath();
  context.fill();
  context.strokeStyle = "rgba(255,255,255,.85)";
  context.lineWidth = 1.5;
  context.stroke();
  return { url: canvas.toDataURL("image/png"), scaledSize: new maps.Size(58, 72), anchor: new maps.Point(22, 60) };
}

function detailCard(title: string, eyebrow: string, rows: Array<[string, string]>, action?: () => void) {
  const card = document.createElement("div");
  card.className = "google-info-card";
  const overline = document.createElement("small");
  overline.textContent = eyebrow;
  const heading = document.createElement("h3");
  heading.textContent = title;
  const grid = document.createElement("div");
  grid.className = "google-info-grid";
  rows.forEach(([label, value]) => {
    const row = document.createElement("p");
    const key = document.createElement("span");
    const content = document.createElement("b");
    key.textContent = label;
    content.textContent = value;
    row.append(key, content);
    grid.append(row);
  });
  card.append(overline, heading, grid);
  if (action) {
    const button = document.createElement("button");
    button.textContent = "Open private conversation →";
    button.addEventListener("click", action);
    card.append(button);
  }
  return card;
}

export default function CommandMap({ nodes, people, selectedId, onSelect, pickingLocation, onPickLocation }: { nodes: MapNode[]; people: MapPerson[]; selectedId: string; onSelect: (id: string) => void; pickingLocation: boolean; onPickLocation: (position: Position) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const mapsRef = useRef<GoogleMaps | null>(null);
  const markersRef = useRef<MarkerInstance[]>([]);
  const infoRef = useRef<InfoWindowInstance | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then((maps) => {
      if (cancelled || !containerRef.current) return;
      mapsRef.current = maps;
      mapRef.current = new maps.Map(containerRef.current, {
        center: { lat: 20.5937, lng: 78.9629 },
        zoom: 5,
        mapTypeControl: true,
        mapTypeControlOptions: { position: 3 },
        streetViewControl: false,
        fullscreenControl: true,
        clickableIcons: false,
        gestureHandling: "greedy",
        styles: [
          { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
          { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
          { featureType: "road", elementType: "geometry", stylers: [{ saturation: -25 }, { lightness: 18 }] },
          { featureType: "water", elementType: "geometry", stylers: [{ color: "#b9ddea" }] },
        ],
      });
      infoRef.current = new maps.InfoWindow();
      setStatus("ready");
    }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; markersRef.current.forEach((marker) => marker.setMap(null)); markersRef.current = []; infoRef.current?.close(); };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;
    map.setOptions({ draggableCursor: pickingLocation ? "crosshair" : null });
    if (!pickingLocation) return;
    const listener = map.addListener("click", (event) => {
      if (!event.latLng) return;
      onPickLocation({ lat: event.latLng.lat(), lng: event.latLng.lng() });
    });
    return () => listener.remove();
  }, [onPickLocation, pickingLocation, status]);

  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (status !== "ready" || !maps || !map) return;
    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];
    infoRef.current?.close();
    const bounds = new maps.LatLngBounds();
    const points: Position[] = [];

    nodes.forEach((node) => {
      if (!Number.isFinite(node.lat) || !Number.isFinite(node.lng)) return;
      const position = { lat: node.lat as number, lng: node.lng as number };
      points.push(position);
      bounds.extend(position);
      const marker = new maps.Marker({ map, position, title: `${node.label} · rescue node`, icon: flagIcon(maps, "#e5484d"), zIndex: 30 });
      marker.addListener("click", () => {
        const rows: Array<[string, string]> = [["Node ID", node.id], ["Coordinates", `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`], ["Status", node.online ? "Online" : "Offline"]];
        if (node.rssi !== undefined) rows.push(["Signal", `${node.rssi} dBm`]);
        if (node.battery !== undefined) rows.push(["Battery", `${node.battery}%`]);
        const info = infoRef.current;
        if (!info) return;
        info.setContent(detailCard(node.label, "RED FLAG · AERO-NODE", rows));
        info.open({ anchor: marker, map });
      });
      markersRef.current.push(marker);
    });

    people.forEach((person) => {
      if (!Number.isFinite(person.lat) || !Number.isFinite(person.lng)) return;
      const position = { lat: person.lat as number, lng: person.lng as number };
      const approximate = person.locationKind === "approximate";
      points.push(position);
      bounds.extend(position);
      const marker = new maps.Marker({ map, position, title: `${person.name} · ${approximate ? "approximate" : "exact"} location`, icon: flagIcon(maps, approximate ? "#e8a238" : "#13aa7d", person.id === selectedId), zIndex: person.id === selectedId ? 50 : 40 });
      marker.addListener("click", () => {
        const rows: Array<[string, string]> = [["Survivor ID", person.id], ["Connected via", person.nodeId], ["Location", approximate ? "Approximate node area" : "Exact GPS"], ["Coordinates", `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`], ["Priority", person.priority === "critical" ? "Critical" : "Normal"]];
        const info = infoRef.current;
        if (!info) return;
        info.setContent(detailCard(person.name, `${approximate ? "AMBER" : "GREEN"} FLAG · CONNECTED SURVIVOR`, rows, () => onSelect(person.id)));
        info.open({ anchor: marker, map });
      });
      markersRef.current.push(marker);
    });

    if (points.length === 1) { map.setCenter(points[0]); map.setZoom(16); }
    if (points.length > 1) map.fitBounds(bounds, 80);
  }, [nodes, people, selectedId, onSelect, status]);

  return <div className="google-map-shell"><div ref={containerRef} className="map-canvas" aria-label="Google Map of live Aero-Node rescue locations" />{status === "loading" && <div className="map-provider-state">Loading Google Maps…</div>}{status === "error" && <div className="map-provider-state error"><b>Google Maps unavailable</b><span>Check the API key, billing and website restriction.</span></div>}{pickingLocation && status === "ready" && <div className="map-pick-hint"><b>Place the master node</b><span>Click the command laptop’s position on the map</span></div>}<div className="map-legend"><span><i className="node-flag" />Nodes</span><span><i className="person-flag" />Survivors</span><span><i className="approx-flag" />Approximate</span></div></div>;
}
