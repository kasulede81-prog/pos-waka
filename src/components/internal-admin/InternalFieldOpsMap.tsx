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

type Props = {
  lang: Language;
  pins: FieldMapPin[];
  accessToken: string | undefined;
};

export function InternalFieldOpsMap({ lang, pins, accessToken }: Props) {
  const mapRef = useRef<MapRef>(null);
  const [clusters, setClusters] = useState<MapFeature[]>([]);
  const [popup, setPopup] = useState<{ lng: number; lat: number; pin: FieldMapPin } | null>(null);

  const validPins = useMemo(() => pins.filter(validPin), [pins]);

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

  useEffect(() => {
    const tmr = window.setTimeout(() => refreshClusters(), 0);
    return () => window.clearTimeout(tmr);
  }, [validPins, clusterIndex, refreshClusters]);

  /** Pins load async after mount; fit map to data whenever pin set / bounds change. */
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !boundsFromPins || !validPins.length) return;
    try {
      map.fitBounds(boundsFromPins, { padding: 56, maxZoom: 14, duration: 550 });
    } catch {
      /* ignore fitBounds errors for degenerate boxes */
    }
    const id = window.setTimeout(() => refreshClusters(), 600);
    return () => window.clearTimeout(id);
  }, [boundsFromPins, validPins.length, refreshClusters]);

  const onClusterClick = useCallback(
    (clusterId: number, lng: number, lat: number) => {
      const map = mapRef.current?.getMap();
      if (!map || !clusterIndex) return;
      try {
        const z = clusterIndex.getClusterExpansionZoom(clusterId);
        map.easeTo({ center: [lng, lat], zoom: Math.min(z, 18), duration: 420 });
      } catch {
        map.easeTo({ center: [lng, lat], zoom: Math.min(map.getZoom() + 2, 18), duration: 420 });
      }
    },
    [clusterIndex],
  );

  const token = accessToken?.trim();
  if (!token) {
    return (
      <p className="rounded-xl bg-white/10 px-3 py-4 text-center text-sm font-semibold text-stone-200">
        {t(lang, "internalAdminMapHint")}
      </p>
    );
  }

  return (
    <div className="relative mt-4 overflow-hidden rounded-2xl ring-1 ring-white/15">
      <div className="relative h-[min(22rem,55vh)] w-full min-h-[220px]">
        <Map
          ref={mapRef}
          mapboxAccessToken={token}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          initialViewState={UG_CENTER}
          style={{ width: "100%", height: "100%" }}
          reuseMaps
          onLoad={refreshClusters}
          onMoveEnd={refreshClusters}
          onClick={() => setPopup(null)}
        >
          <NavigationControl position="top-right" showCompass={false} />

          {clusters.map((feature) => {
            const [lng, lat] = feature.geometry.coordinates;
            const props = feature.properties;
            if (props && "cluster" in props && props.cluster) {
              const count = props.point_count ?? 0;
              const size = Math.min(52, 34 + Math.min(18, Math.log2(count + 1) * 10));
              return (
                <Marker key={`c-${props.cluster_id}`} longitude={lng} latitude={lat}>
                  <button
                    type="button"
                    className="flex cursor-pointer items-center justify-center rounded-full border-2 border-orange-200/90 bg-gradient-to-br from-orange-500 to-amber-600 font-mono font-black text-white shadow-lg outline-none ring-2 ring-black/20 transition hover:scale-105 hover:from-orange-400 hover:to-amber-500"
                    style={{ width: size, height: size, fontSize: size > 44 ? 14 : 12 }}
                    title={t(lang, "internalMapClusterTap")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClusterClick(props.cluster_id, lng, lat);
                    }}
                  >
                    {count}
                  </button>
                </Marker>
              );
            }
            const p = props as PinProps;
            const pin: FieldMapPin = {
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
                  className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-2 border-white/90 bg-orange-500 shadow-md outline-none transition hover:scale-110 hover:bg-orange-400"
                  title={p.shop_name}
                  aria-label={p.shop_name}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPopup({ lng, lat, pin });
                  }}
                >
                  <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-white/90 bg-orange-500" />
                </button>
              </Marker>
            );
          })}

          {popup ? (
            <Popup
              longitude={popup.lng}
              latitude={popup.lat}
              anchor="bottom"
              offset={16}
              onClose={() => setPopup(null)}
              closeButton
              closeOnClick={false}
              maxWidth="280px"
            >
              <div className="min-w-[200px] p-1 text-stone-900">
                <p className="font-black leading-tight">{popup.pin.shop_name}</p>
                <p className="mt-1 text-xs font-semibold text-stone-600">
                  {[popup.pin.district, popup.pin.city].filter(Boolean).join(" · ") || "—"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    to={`/internal/waka/shop/${popup.pin.shop_id}`}
                    className="inline-flex rounded-lg bg-stone-900 px-3 py-2 text-xs font-black text-white hover:bg-stone-800"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t(lang, "internalMapOpenShop")}
                  </Link>
                  <a
                    href={googleMapsDirectionsUrl(popup.pin.lat, popup.pin.lng)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex rounded-lg border-2 border-orange-500 bg-orange-50 px-3 py-2 text-xs font-black text-orange-900 hover:bg-orange-100"
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
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/55 px-4">
            <p className="max-w-sm text-center text-sm font-bold text-white drop-shadow-md">{t(lang, "internalMapNoPins")}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
