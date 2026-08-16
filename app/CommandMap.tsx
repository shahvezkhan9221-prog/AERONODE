"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type MapNode = { id: string; label: string; lat?: number; lng?: number; online: boolean; rssi?: number; battery?: number };
type MapPerson = { id: string; name: string; nodeId: string; lat?: number; lng?: number; priority: "critical" | "normal"; locationKind?: "exact" | "approximate" };
type Position = { lat: number; lng: number };
type LatLng = { lat(): number; lng(): number };
type MapMouseEvent = { latLng?: LatLng };
type Listener = { remove(): void };
type Bounds = { extend(position: Position): void };
type StreetView = { setPosition(position: Position): void; setPov(pov: { heading: number; pitch: number }): void; setVisible(visible: boolean): void };
type MapInstance = {
  fitBounds(bounds: Bounds, padding?: number): void;
  getCenter(): LatLng | undefined;
  getStreetView(): StreetView;
  setCenter(position: Position): void;
  setMapTypeId(mapTypeId: string): void;
  setOptions(options: Record<string, unknown>): void;
  setTilt(tilt: number): void;
  setZoom(zoom: number): void;
  addListener(event: string, handler: (event: MapMouseEvent) => void): Listener;
};
type MarkerInstance = {
  setMap(map: MapInstance | null): void;
  setPosition(position: Position): void;
  setIcon(icon: unknown): void;
  setTitle(title: string): void;
  setZIndex(zIndex: number): void;
  addListener(event: string, handler: () => void): Listener;
};
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
type MarkerRecord = { marker: MarkerInstance; visual: string };

const DEFAULT_CENTER = { lat: 28.462802, lng: 77.493290 };
const NODE_RED = "#e5484d";
const SURVIVOR_GREEN = "#13aa7d";
const APPROXIMATE_GREEN = "#4bbf91";

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
  const markerRecordsRef = useRef<Map<string, MarkerRecord>>(new Map());
  const infoRef = useRef<InfoWindowInstance | null>(null);
  const nodesRef = useRef(nodes);
  const peopleRef = useRef(people);
  const onSelectRef = useRef(onSelect);
  const onPickLocationRef = useRef(onPickLocation);
  const viewportSignatureRef = useRef("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [buildings3d, setBuildings3d] = useState(false);

  useEffect(() => {
    nodesRef.current = nodes;
    peopleRef.current = people;
    onSelectRef.current = onSelect;
    onPickLocationRef.current = onPickLocation;
  }, [nodes, people, onSelect, onPickLocation]);

  useEffect(() => {
    let cancelled = false;
    const markerRecords = markerRecordsRef.current;
    loadGoogleMaps().then((maps) => {
      if (cancelled || !containerRef.current) return;
      mapsRef.current = maps;
      mapRef.current = new maps.Map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom: 16,
        mapTypeControl: true,
        mapTypeControlOptions: { position: 3 },
        streetViewControl: true,
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
    return () => {
      cancelled = true;
      markerRecords.forEach(({ marker }) => marker.setMap(null));
      markerRecords.clear();
      infoRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;
    map.setOptions({ draggableCursor: pickingLocation ? "crosshair" : null });
    if (!pickingLocation) return;
    const listener = map.addListener("click", (event) => {
      if (event.latLng) onPickLocationRef.current({ lat: event.latLng.lat(), lng: event.latLng.lng() });
    });
    return () => listener.remove();
  }, [pickingLocation, status]);

  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (status !== "ready" || !maps || !map) return;
    const activeKeys = new Set<string>();
    const points: Position[] = [];

    nodes.forEach((node) => {
      if (!Number.isFinite(node.lat) || !Number.isFinite(node.lng)) return;
      const key = `node:${node.id}`;
      const position = { lat: node.lat as number, lng: node.lng as number };
      const title = `${node.label} · rescue node`;
      activeKeys.add(key);
      points.push(position);
      let record = markerRecordsRef.current.get(key);
      if (!record) {
        const marker = new maps.Marker({ map, position, title, icon: flagIcon(maps, NODE_RED), zIndex: 30 });
        marker.addListener("click", () => {
          const current = nodesRef.current.find((item) => item.id === node.id);
          if (!current || !Number.isFinite(current.lat) || !Number.isFinite(current.lng)) return;
          const currentPosition = { lat: current.lat as number, lng: current.lng as number };
          const rows: Array<[string, string]> = [["Node ID", current.id], ["Coordinates", `${currentPosition.lat.toFixed(6)}, ${currentPosition.lng.toFixed(6)}`], ["Status", current.online ? "Online" : "Offline"]];
          if (current.rssi !== undefined) rows.push(["Signal", `${current.rssi} dBm`]);
          if (current.battery !== undefined) rows.push(["Battery", `${current.battery}%`]);
          infoRef.current?.setContent(detailCard(current.label, "RED FLAG · AERO-NODE", rows));
          infoRef.current?.open({ anchor: marker, map });
        });
        record = { marker, visual: "node" };
        markerRecordsRef.current.set(key, record);
      } else {
        record.marker.setPosition(position);
        record.marker.setTitle(title);
        record.marker.setZIndex(30);
      }
    });

    people.forEach((person) => {
      if (!Number.isFinite(person.lat) || !Number.isFinite(person.lng)) return;
      const key = `person:${person.id}`;
      const position = { lat: person.lat as number, lng: person.lng as number };
      const approximate = person.locationKind === "approximate";
      const selected = person.id === selectedId;
      const visual = `${approximate ? "approximate" : "exact"}:${selected ? "selected" : "normal"}`;
      const title = `${person.name} · ${approximate ? "approximate" : "exact"} location`;
      activeKeys.add(key);
      points.push(position);
      let record = markerRecordsRef.current.get(key);
      if (!record) {
        const marker = new maps.Marker({ map, position, title, icon: flagIcon(maps, approximate ? APPROXIMATE_GREEN : SURVIVOR_GREEN, selected), zIndex: selected ? 50 : 40 });
        marker.addListener("click", () => {
          const current = peopleRef.current.find((item) => item.id === person.id);
          if (!current || !Number.isFinite(current.lat) || !Number.isFinite(current.lng)) return;
          const currentPosition = { lat: current.lat as number, lng: current.lng as number };
          const currentApproximate = current.locationKind === "approximate";
          const rows: Array<[string, string]> = [["Survivor ID", current.id], ["Connected via", current.nodeId], ["Location", currentApproximate ? "Approximate node area" : "Exact GPS"], ["Coordinates", `${currentPosition.lat.toFixed(6)}, ${currentPosition.lng.toFixed(6)}`], ["Priority", current.priority === "critical" ? "Critical" : "Normal"]];
          infoRef.current?.setContent(detailCard(current.name, `GREEN FLAG · ${currentApproximate ? "APPROXIMATE" : "CONNECTED SURVIVOR"}`, rows, () => onSelectRef.current(current.id)));
          infoRef.current?.open({ anchor: marker, map });
        });
        record = { marker, visual };
        markerRecordsRef.current.set(key, record);
      } else {
        record.marker.setPosition(position);
        record.marker.setTitle(title);
        record.marker.setZIndex(selected ? 50 : 40);
        if (record.visual !== visual) {
          record.marker.setIcon(flagIcon(maps, approximate ? APPROXIMATE_GREEN : SURVIVOR_GREEN, selected));
          record.visual = visual;
        }
      }
    });

    markerRecordsRef.current.forEach(({ marker }, key) => {
      if (!activeKeys.has(key)) {
        marker.setMap(null);
        markerRecordsRef.current.delete(key);
      }
    });

    const viewportSignature = [...activeKeys].sort().join("|");
    if (viewportSignature !== viewportSignatureRef.current) {
      viewportSignatureRef.current = viewportSignature;
      if (points.length === 1) {
        map.setCenter(points[0]);
        map.setZoom(16);
      } else if (points.length > 1) {
        const bounds = new maps.LatLngBounds();
        points.forEach((position) => bounds.extend(position));
        map.fitBounds(bounds, 80);
      }
    }
  }, [nodes, people, selectedId, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;
    map.setMapTypeId(buildings3d ? "hybrid" : "roadmap");
    map.setTilt(buildings3d ? 45 : 0);
  }, [buildings3d, status]);

  const openStreetView = useCallback(() => {
    const map = mapRef.current;
    const center = map?.getCenter();
    if (!map || !center) return;
    const panorama = map.getStreetView();
    panorama.setPosition({ lat: center.lat(), lng: center.lng() });
    panorama.setPov({ heading: 0, pitch: 0 });
    panorama.setVisible(true);
  }, []);

  return <div className="google-map-shell">
    <div ref={containerRef} className="map-canvas" aria-label="Google Map of live Aero-Node rescue locations" />
    {status === "loading" && <div className="map-provider-state">Loading Google Maps…</div>}
    {status === "error" && <div className="map-provider-state error"><b>Google Maps unavailable</b><span>Check the API key, billing and website restriction.</span></div>}
    {pickingLocation && status === "ready" && <div className="map-pick-hint"><b>Place the master node</b><span>Click the command laptop’s position on the map</span></div>}
    {status === "ready" && <div className="map-view-controls" aria-label="Map view options">
      <button type="button" onClick={openStreetView}>◉ Street View</button>
      <button type="button" className={buildings3d ? "active" : ""} aria-pressed={buildings3d} onClick={() => setBuildings3d((current) => !current)}>▰ 3D buildings</button>
    </div>}
    <div className="map-legend"><span><i className="node-flag" />Nodes</span><span><i className="person-flag" />Survivors</span><span><i className="approx-flag" />Approximate</span></div>
  </div>;
}
