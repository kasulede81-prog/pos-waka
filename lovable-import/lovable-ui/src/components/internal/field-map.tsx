import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

export type MapPin = {
  id: string;
  name: string;
  district?: string | null;
  is_active: boolean;
  gps_lat: number;
  gps_lng: number;
};

const TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ||
  (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined);

export function FieldMap({ pins }: { pins: MapPin[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!TOKEN || !ref.current) return;
    mapboxgl.accessToken = TOKEN;
    const map = new mapboxgl.Map({
      container: ref.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [32.2903, 1.3733], // Uganda
      zoom: 5.8,
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers: mapboxgl.Marker[] = [];
    const addPins = () => {
      pins.slice(0, 400).forEach((p) => {
        const el = document.createElement("div");
        el.style.cssText = `width:14px;height:14px;border-radius:9999px;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);background:${p.is_active ? "#16a34a" : "#9ca3af"}`;
        const popup = new mapboxgl.Popup({ offset: 12 }).setHTML(
          `<div style="font-family:system-ui;font-size:12px"><div style="font-weight:700">${p.name}</div><div>${p.district ?? ""}</div><a href="/internal/waka/shop/${p.id}">Open shop →</a></div>`
        );
        markers.push(new mapboxgl.Marker(el).setLngLat([p.gps_lng, p.gps_lat]).setPopup(popup).addTo(map));
      });
    };
    if (map.loaded()) addPins(); else map.on("load", addPins);
    return () => { markers.forEach((m) => m.remove()); };
  }, [pins]);

  if (!TOKEN) {
    return (
      <div className="grid h-64 place-items-center rounded-xl border border-dashed border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
        Set <code className="rounded bg-background px-1.5 py-0.5">VITE_MAPBOX_TOKEN</code> to enable the field map.
      </div>
    );
  }
  return <div ref={ref} className="h-96 w-full overflow-hidden rounded-xl border border-border" />;
}
