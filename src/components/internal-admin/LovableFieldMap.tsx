import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { FieldMapPin } from "../../lib/wakaInternalAdmin";

const TOKEN =
  import.meta.env.VITE_MAPBOX_TOKEN?.trim() || import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();

type Props = {
  pins: FieldMapPin[];
};

/** Lightweight Mapbox map (from Lovable import). */
export function LovableFieldMap({ pins }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!TOKEN || !ref.current) return;
    mapboxgl.accessToken = TOKEN;
    const map = new mapboxgl.Map({
      container: ref.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [32.2903, 1.3733],
      zoom: 5.8,
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers: mapboxgl.Marker[] = [];

    const addPins = () => {
      pins.slice(0, 400).forEach((p) => {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
        const el = document.createElement("div");
        el.style.cssText = `width:14px;height:14px;border-radius:9999px;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);background:${p.is_active ? "#16a34a" : "#9ca3af"}`;
        const popup = new mapboxgl.Popup({ offset: 12 }).setHTML(
          `<div style="font-family:system-ui;font-size:12px"><div style="font-weight:700">${escapeHtml(p.shop_name)}</div><div>${escapeHtml(p.district ?? "")}</div></div>`,
        );
        const marker = new mapboxgl.Marker(el).setLngLat([p.lng, p.lat]).setPopup(popup).addTo(map);
        markers.push(marker);
      });
    };

    if (map.loaded()) addPins();
    else map.on("load", addPins);

    return () => {
      markers.forEach((m) => m.remove());
    };
  }, [pins]);

  if (!TOKEN) {
    return (
      <div className="grid h-64 place-items-center rounded-xl border border-dashed border-stone-300 bg-stone-50 p-6 text-center text-sm text-stone-600">
        Set <code className="rounded bg-white px-1.5 py-0.5">VITE_MAPBOX_TOKEN</code> to enable the field map.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div ref={ref} className="h-96 w-full overflow-hidden rounded-xl border border-stone-200" />
      {pins.length > 0 ? (
        <p className="text-xs font-semibold text-stone-500">
          {pins.length} shops with GPS · tap a pin for details, or open from Recent shops below.
        </p>
      ) : null}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
