import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { FieldMapPin } from "../../lib/wakaInternalAdmin";

const TOKEN =
  import.meta.env.VITE_MAPBOX_TOKEN?.trim() || import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();

type Props = {
  pins: FieldMapPin[];
};

/** Lightweight Mapbox map fallback when token env is missing from advanced map. */
export function LovableFieldMap({ pins }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  useEffect(() => {
    if (!TOKEN || !ref.current || mapRef.current) return;
    mapboxgl.accessToken = TOKEN;
    const map = new mapboxgl.Map({
      container: ref.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [32.2903, 1.3733],
      zoom: 5.8,
    });
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const clearMarkers = () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };

    const addPins = () => {
      clearMarkers();
      const valid = pins.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).slice(0, 400);
      for (const p of valid) {
        const el = document.createElement("div");
        el.style.cssText = `width:14px;height:14px;border-radius:9999px;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);background:${p.is_active ? "#16a34a" : "#9ca3af"}`;
        const popup = new mapboxgl.Popup({ offset: 12 }).setHTML(
          `<div style="font-family:system-ui;font-size:12px"><div style="font-weight:700">${escapeHtml(p.shop_name)}</div><div>${escapeHtml(p.district ?? "")}</div></div>`,
        );
        const marker = new mapboxgl.Marker(el).setLngLat([p.lng, p.lat]).setPopup(popup).addTo(map);
        markersRef.current.push(marker);
      }
      if (valid.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        valid.forEach((p) => bounds.extend([p.lng, p.lat]));
        map.fitBounds(bounds, { padding: 48, maxZoom: 12, duration: 0 });
      }
    };

    if (map.loaded()) addPins();
    else map.once("load", addPins);
  }, [pins]);

  if (!TOKEN) {
    return (
      <div className="grid h-64 place-items-center rounded-xl border border-dashed border-border bg-muted p-6 text-center text-sm text-muted-foreground">
        Set <code className="rounded bg-card px-1.5 py-0.5">VITE_MAPBOX_TOKEN</code> to enable the field map.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div ref={ref} className="h-96 w-full overflow-hidden rounded-xl border border-border" />
      {pins.length > 0 ? (
        <p className="text-xs font-semibold text-muted-foreground">{pins.length} shops with GPS · tap a pin for details.</p>
      ) : (
        <p className="text-xs font-semibold text-amber-800">No GPS pins yet — shops need location from onboarding.</p>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
