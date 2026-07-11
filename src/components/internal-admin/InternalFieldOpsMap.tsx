import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Map, { Marker, NavigationControl, Popup, type MapRef } from "react-map-gl/mapbox";
import Supercluster from "supercluster";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { FieldMapPin } from "../../lib/wakaInternalAdmin";
import { googleMapsDirectionsUrl } from "../../lib/wakaInternalAdmin";

type PinProps = {
  cluster?: false;
  shop_id: string;
  shop_name: string;
  district: string | null;
  is_active: boolean;
};

type MapFeature = Supercluster.PointFeature<PinProps> | Supercluster.ClusterFeature<Supercluster.AnyProps>;

function validPin(p: FieldMapPin): boolean {
  const { lat, lng } = p;
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

const UG_CENTER = { longitude: 32.2901, latitude: 1.3733, zoom: 6.2 };
const SPIDER_ZOOM_THRESHOLD = 17;
const MAX_MAP_ZOOM = 18;

function pinById(pins: FieldMapPin[], shopId: string): FieldMapPin | undefined {
  return pins.find((p) => p.shop_id === shopId);
}

function layoutSpiderPins(centerLat: number, centerLng: number, pins: FieldMapPin[]): FieldMapPin[] {
  const n = pins.length;
  const base = 0.00026;
  return pins.map((pin, i) => {
    const ang = (2 * Math.PI * i) / Math.max(n, 1) - Math.PI / 2;
    const scale = 1 + Math.min(2.2, n / 10);
    const r = base * scale;
    const dlat = r * Math.sin(ang);
    const dlng = (r * Math.cos(ang)) / Math.cos((centerLat * Math.PI) / 180);
    return {
      ...pin,
      lat: centerLat + dlat,
      lng: centerLng + dlng,
    };
  });
}

type SpiderState = {
  clusterId: number;
  centerLng: number;
  centerLat: number;
  /** Pins offset into spider arms (same metadata as source). */
  displayPins: FieldMapPin[];
  sourcePins: FieldMapPin[];
};

type Props = {
  lang: Language;
  pins: FieldMapPin[];
  accessToken: string | undefined;
};

export function InternalFieldOpsMap({ lang, pins, accessToken }: Props) {
  const mapRef = useRef<MapRef>(null);
  const [clusters, setClusters] = useState<MapFeature[]>([]);
  const [popup, setPopup] = useState<{ lng: number; lat: number; pin: FieldMapPin } | null>(null);
  const [spider, setSpider] = useState<SpiderState | null>(null);
  const [spiderLines, setSpiderLines] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
  const [lineOpacity, setLineOpacity] = useState(0);

  const validPins = useMemo(() => pins.filter(validPin), [pins]);

  const spiderShopIds = useMemo(() => new Set(spider?.sourcePins.map((p) => p.shop_id) ?? []), [spider]);

  const boundsFromPins = useMemo((): [[number, number], [number, number]] | null => {
    if (!validPins.length) return null;
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const p of validPins) {
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
    }
    if (!Number.isFinite(minLng)) return null;
    const pad = 0.04;
    return [
      [minLng - pad, minLat - pad],
      [maxLng + pad, maxLat + pad],
    ];
  }, [validPins]);

  const clusterIndex = useMemo(() => {
    const index = new Supercluster<PinProps>({
      radius: 68,
      maxZoom: 18,
      minZoom: 0,
      minPoints: 2,
      extent: 512,
    });
    const features: Supercluster.PointFeature<PinProps>[] = validPins.map((p) => ({
      type: "Feature",
      properties: {
        cluster: false,
        shop_id: p.shop_id,
        shop_name: p.shop_name,
        district: p.district,
        is_active: p.is_active,
      },
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    }));
    index.load(features);
    return index;
  }, [validPins]);

  const refreshClusters = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !clusterIndex) return;
    const b = map.getBounds();
    if (!b) return;
    const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const zoom = Math.max(0, Math.floor(map.getZoom()));
    setClusters(clusterIndex.getClusters(bbox, zoom) as MapFeature[]);
  }, [clusterIndex]);

  const updateSpiderLines = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !spider) {
      setSpiderLines([]);
      return;
    }
    try {
      const c = map.project([spider.centerLng, spider.centerLat]);
      const lines = spider.displayPins.map((leaf) => {
        const p = map.project([leaf.lng, leaf.lat]);
        return { x1: c.x, y1: c.y, x2: p.x, y2: p.y };
      });
      setSpiderLines(lines);
    } catch {
      setSpiderLines([]);
    }
  }, [spider]);

  useEffect(() => {
    const tmr = window.setTimeout(() => refreshClusters(), 0);
    return () => window.clearTimeout(tmr);
  }, [validPins, clusterIndex, refreshClusters]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !boundsFromPins || !validPins.length) return;
    try {
      map.fitBounds(boundsFromPins, { padding: 56, maxZoom: 14, duration: 550 });
    } catch {
      /* ignore */
    }
    const id = window.setTimeout(() => refreshClusters(), 600);
    return () => window.clearTimeout(id);
  }, [boundsFromPins, validPins.length, refreshClusters]);

  useEffect(() => {
    if (!spider) {
      setLineOpacity(0);
      setSpiderLines([]);
      return;
    }
    updateSpiderLines();
    const id = window.requestAnimationFrame(() => setLineOpacity(1));
    const map = mapRef.current?.getMap();
    if (!map) return () => cancelAnimationFrame(id);
    const onMove = () => updateSpiderLines();
    map.on("move", onMove);
    map.on("zoom", onMove);
    return () => {
      cancelAnimationFrame(id);
      map.off("move", onMove);
      map.off("zoom", onMove);
    };
  }, [spider, updateSpiderLines]);

  const openOrSpiderCluster = useCallback(
    (clusterId: number, lng: number, lat: number) => {
      const map = mapRef.current?.getMap();
      if (!map || !clusterIndex) return;
      const z = map.getZoom();
      let expansionZ = MAX_MAP_ZOOM;
      try {
        expansionZ = clusterIndex.getClusterExpansionZoom(clusterId);
      } catch {
        expansionZ = z + 2;
      }
      const atMaxSpread = z >= SPIDER_ZOOM_THRESHOLD - 0.01 || z >= expansionZ - 0.25;
      if (atMaxSpread) {
        let raw: ReturnType<Supercluster<PinProps>["getLeaves"]>;
        try {
          raw = clusterIndex.getLeaves(clusterId, 500, 0);
        } catch {
          return;
        }
        const sourcePins: FieldMapPin[] = [];
        for (const leaf of raw) {
          const f = leaf as Supercluster.PointFeature<PinProps>;
          const sid = f.properties?.shop_id;
          if (!sid) continue;
          const full = pinById(validPins, sid);
          if (full) sourcePins.push(full);
        }
        if (!sourcePins.length) return;
        const displayPins = layoutSpiderPins(lat, lng, sourcePins);
        setPopup(null);
        setSpider({ clusterId, centerLng: lng, centerLat: lat, displayPins, sourcePins });
        refreshClusters();
        return;
      }
      try {
        map.easeTo({ center: [lng, lat], zoom: Math.min(expansionZ, MAX_MAP_ZOOM), duration: 420 });
      } catch {
        map.easeTo({ center: [lng, lat], zoom: Math.min(z + 2, MAX_MAP_ZOOM), duration: 420 });
      }
    },
    [clusterIndex, validPins, refreshClusters],
  );

  const token = accessToken?.trim();
  if (!token) {
    return (
      <p className="rounded-xl bg-white/10 px-3 py-4 text-center text-sm font-semibold text-muted-foreground">
        {t(lang, "internalAdminMapHint")}
      </p>
    );
  }

  const fmtLastActive = (iso: string | null | undefined) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Kampala" });
    } catch {
      return "—";
    }
  };

  return (
    <div className="relative mt-4 overflow-hidden rounded-2xl ring-1 ring-white/15">
      <div className="relative h-[min(22rem,55vh)] w-full min-h-[220px]">
        <Map
          ref={mapRef}
          mapboxAccessToken={token}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          initialViewState={UG_CENTER}
          maxZoom={MAX_MAP_ZOOM}
          style={{ width: "100%", height: "100%" }}
          reuseMaps
          onLoad={refreshClusters}
          onMoveEnd={refreshClusters}
          onClick={() => {
            setPopup(null);
            setSpider(null);
          }}
        >
          <NavigationControl position="top-right" showCompass={false} />

          {spider && spiderLines.length ? (
            <svg
              className="pointer-events-none absolute inset-0 z-[5] overflow-visible"
              style={{ width: "100%", height: "100%", opacity: lineOpacity, transition: "opacity 0.25s ease-out" }}
              aria-hidden
            >
              {spiderLines.map((ln, i) => (
                <line
                  key={i}
                  x1={ln.x1}
                  y1={ln.y1}
                  x2={ln.x2}
                  y2={ln.y2}
                  stroke="rgba(251, 146, 60, 0.92)"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  style={{ transition: "stroke-dashoffset 0.35s ease-out", strokeDashoffset: lineOpacity ? 0 : 40 }}
                />
              ))}
            </svg>
          ) : null}

          {spider ? (
            <div className="absolute left-3 top-12 z-[15] flex flex-col gap-2">
              <button
                type="button"
                className="rounded-full bg-foreground/90 px-3 py-1.5 text-xs font-black text-background shadow-lg ring-1 ring-white/20"
                onClick={(e) => {
                  e.stopPropagation();
                  setSpider(null);
                  refreshClusters();
                }}
              >
                {t(lang, "internalSpiderClose")}
              </button>
            </div>
          ) : null}

          {clusters.map((feature) => {
            const [lng, lat] = feature.geometry.coordinates;
            const props = feature.properties;
            if (props && "cluster" in props && props.cluster) {
              if (spider && props.cluster_id === spider.clusterId) return null;
              const count = props.point_count ?? 0;
              const size = Math.min(52, 34 + Math.min(18, Math.log2(count + 1) * 10));
              return (
                <Marker key={`c-${props.cluster_id}`} longitude={lng} latitude={lat}>
                  <button
                    type="button"
                    className="flex cursor-pointer items-center justify-center rounded-full border-2 border-waka-200/90 bg-gradient-to-br from-waka-500 to-amber-600 font-mono font-black text-white shadow-lg outline-none ring-2 ring-black/20 transition hover:scale-105 hover:from-waka-400 hover:to-amber-500"
                    style={{ width: size, height: size, fontSize: size > 44 ? 14 : 12 }}
                    title={t(lang, "internalMapClusterTap")}
                    onClick={(e) => {
                      e.stopPropagation();
                      openOrSpiderCluster(props.cluster_id, lng, lat);
                    }}
                  >
                    {count}
                  </button>
                </Marker>
              );
            }
            const p = props as PinProps;
            if (spiderShopIds.has(p.shop_id)) return null;
            const full = pinById(validPins, p.shop_id);
            const pin: FieldMapPin = full
              ? { ...full, lat, lng }
              : {
                  shop_id: p.shop_id,
                  shop_name: p.shop_name,
                  lat,
                  lng,
                  district: p.district ?? null,
                  city: null,
                  is_active: p.is_active,
                  district_id: null,
                };
            return (
              <Marker key={p.shop_id} longitude={lng} latitude={lat} anchor="bottom">
                <button
                  type="button"
                  className="relative z-[12] flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-2 border-white/90 bg-waka-500 shadow-md outline-none transition hover:scale-110 hover:bg-waka-400"
                  title={p.shop_name}
                  aria-label={p.shop_name}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSpider(null);
                    setPopup({ lng, lat, pin });
                  }}
                >
                  <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-white/90 bg-waka-500" />
                </button>
              </Marker>
            );
          })}

          {spider
            ? spider.displayPins.map((leaf) => (
                <Marker key={`spider-${leaf.shop_id}`} longitude={leaf.lng} latitude={leaf.lat} anchor="bottom">
                  <button
                    type="button"
                    className="relative z-[14] flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-amber-100 bg-amber-500 shadow-lg outline-none transition hover:scale-110 hover:bg-amber-400"
                    title={leaf.shop_name}
                    onClick={(e) => {
                      e.stopPropagation();
                      const src = pinById(validPins, leaf.shop_id) ?? leaf;
                      setPopup({ lng: leaf.lng, lat: leaf.lat, pin: src });
                    }}
                  >
                    <span className="absolute -bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 border-b border-r border-amber-100 bg-amber-500" />
                  </button>
                </Marker>
              ))
            : null}

          {popup ? (
            <Popup
              longitude={popup.lng}
              latitude={popup.lat}
              anchor="bottom"
              offset={16}
              onClose={() => setPopup(null)}
              closeButton
              closeOnClick={false}
              maxWidth="300px"
            >
              <div className="min-w-[220px] p-1 text-foreground">
                <p className="font-black leading-tight">{popup.pin.shop_name}</p>
                <dl className="mt-2 space-y-1 text-xs font-semibold text-muted-foreground">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t(lang, "internalMapOwnerLabel")}</dt>
                    <dd className="text-right font-bold text-foreground">{popup.pin.owner_label ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t(lang, "internalMapPlanLabel")}</dt>
                    <dd className="text-right uppercase text-waka-800">{popup.pin.plan_code ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t(lang, "internalMapLastActive")}</dt>
                    <dd className="text-right font-mono text-[11px] text-foreground">{fmtLastActive(popup.pin.last_seen_at)}</dd>
                  </div>
                </dl>
                <p className="mt-1 text-xs font-semibold text-muted-foreground">
                  {[popup.pin.district, popup.pin.city].filter(Boolean).join(" · ") || "—"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    to={`/internal/waka/shop/${popup.pin.shop_id}`}
                    className="inline-flex rounded-lg bg-foreground px-3 py-2 text-xs font-black text-background hover:bg-foreground"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t(lang, "internalMapOpenShop")}
                  </Link>
                  <a
                    href={googleMapsDirectionsUrl(
                      pinById(validPins, popup.pin.shop_id)?.lat ?? popup.pin.lat,
                      pinById(validPins, popup.pin.shop_id)?.lng ?? popup.pin.lng,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex rounded-lg border-2 border-waka-500 bg-waka-50 px-3 py-2 text-xs font-black text-waka-900 hover:bg-waka-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t(lang, "internalVisitDirections")}
                  </a>
                </div>
              </div>
            </Popup>
          ) : null}
        </Map>

        {validPins.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-foreground/55 px-4">
            <p className="max-w-sm text-center text-sm font-bold text-white drop-shadow-md">{t(lang, "internalMapNoPins")}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
