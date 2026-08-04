import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Camera, LayoutGrid } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { EnterpriseCard } from "../components/enterprise/EnterpriseCard";
import { Body, Caption, SectionTitle } from "../components/enterprise/EnterpriseTypography";
import { WakaButton } from "../components/ui/wakaPrimitives";
import { loadVisionRegistry } from "../features/vision/registry";
import { resolveVisionShopScopeId } from "../features/vision/shopScope";
import { getVisionEdgeAgentInfo } from "../features/vision/edgeClient";
import type { VisionCamera, VisionGridSize, VisionEdgeAgentInfo, VisionStreamSession } from "../features/vision/types";
import {
  clampVisionGrid,
  preferSubstreamForGrid,
  resolveDefaultVisionGrid,
  visionGridClass,
} from "../features/vision/streaming/layouts";
import { VisionLiveTile } from "../features/vision/components/VisionLiveTile";
import { VisionCameraDetailsPanel } from "../features/vision/components/VisionCameraDetailsPanel";

const GRID_OPTIONS: VisionGridSize[] = [1, 2, 4, 9, 16];

function parseGridParam(raw: string | null): VisionGridSize | null {
  const n = Number(raw);
  return GRID_OPTIONS.includes(n as VisionGridSize) ? (n as VisionGridSize) : null;
}

export function VisionLiveViewPage({ lang }: { lang: Language }) {
  const shopScopeId = resolveVisionShopScopeId();
  const [searchParams] = useSearchParams();
  const [cameras, setCameras] = useState<VisionCamera[]>([]);
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState<VisionEdgeAgentInfo | null>(null);
  const [grid, setGrid] = useState<VisionGridSize>(() => {
    const fromQuery = parseGridParam(searchParams.get("grid"));
    if (fromQuery) return fromQuery;
    return typeof window !== "undefined" ? resolveDefaultVisionGrid(window.innerWidth) : 4;
  });
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("camera"));
  const [layoutCameraIds, setLayoutCameraIds] = useState<string[] | null>(() => {
    const raw = searchParams.get("cameras");
    if (!raw) return null;
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  });
  const [selectedSession, setSelectedSession] = useState<VisionStreamSession | null>(null);
  const [isPhone, setIsPhone] = useState(false);

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      setIsPhone(w < 640);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const g = parseGridParam(searchParams.get("grid"));
    if (g) setGrid(g);
    const cam = searchParams.get("camera");
    if (cam) setSelectedId(cam);
    const raw = searchParams.get("cameras");
    setLayoutCameraIds(raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : null);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const [list, info] = await Promise.all([loadVisionRegistry(shopScopeId), getVisionEdgeAgentInfo()]);
      if (cancelled) return;
      setCameras(list);
      setAgent(info);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [shopScopeId]);

  const orderedCameras = useMemo(() => {
    if (!layoutCameraIds?.length) return cameras;
    const byId = new Map(cameras.map((c) => [c.id, c]));
    const picked = layoutCameraIds.map((id) => byId.get(id)).filter(Boolean) as VisionCamera[];
    const rest = cameras.filter((c) => !layoutCameraIds.includes(c.id));
    return [...picked, ...rest];
  }, [cameras, layoutCameraIds]);

  const effectiveGrid = clampVisionGrid(grid, orderedCameras.length, isPhone);
  const preferSub = preferSubstreamForGrid(effectiveGrid);
  const visibleCameras = useMemo(() => {
    if (effectiveGrid === 1 && selectedId) {
      const one = orderedCameras.find((c) => c.id === selectedId);
      return one ? [one] : orderedCameras.slice(0, 1);
    }
    return orderedCameras.slice(0, effectiveGrid);
  }, [orderedCameras, effectiveGrid, selectedId]);

  const selected = orderedCameras.find((c) => c.id === selectedId) ?? null;

  return (
    <BackOfficePageLayout
      header={
        <EnterprisePageHeader
          lang={lang}
          title={t(lang, "visionLiveTitle")}
          subtitle={t(lang, "visionLiveSub")}
          backFallback="/office/vision/monitor"
          compact
        />
      }
    >
      <div className="space-y-4 pb-10">
        <EnterpriseCard className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <SectionTitle>{t(lang, "visionLiveWorkspace")}</SectionTitle>
            <Body className="text-sm text-muted-foreground">
              {agent?.available
                ? agent.mediamtxAvailable
                  ? t(lang, "visionLiveMtxReady")
                  : t(lang, "visionLiveMtxMissing")
                : t(lang, "visionEdgeOffline")}
            </Body>
            {agent?.message ? <Caption className="text-amber-700 dark:text-amber-400">{agent.message}</Caption> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Caption className="text-muted-foreground">
              <LayoutGrid className="mr-1 inline h-3.5 w-3.5" aria-hidden />
              {t(lang, "visionLiveGrid")}
            </Caption>
            {GRID_OPTIONS.map((size) => (
              <WakaButton
                key={size}
                type="button"
                size="standard"
                variant={grid === size ? "primary" : "secondary"}
                disabled={isPhone && size !== 1}
                onClick={() => setGrid(size)}
              >
                {size === 1 ? "1" : size === 2 ? "2" : `${size}`}
              </WakaButton>
            ))}
            <Link
              to="/office/vision/monitor"
              className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-primary underline-offset-2 hover:underline"
            >
              {t(lang, "visionMonTitle")}
            </Link>
            <Link
              to="/office/vision"
              className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-primary underline-offset-2 hover:underline"
            >
              {t(lang, "visionLiveManageCameras")}
            </Link>
          </div>
        </EnterpriseCard>

        {loading ? (
          <Caption>{t(lang, "visionLoading")}</Caption>
        ) : orderedCameras.length === 0 ? (
          <EnterpriseCard className="flex items-start gap-3 p-4">
            <Camera className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden />
            <div>
              <Body className="font-medium">{t(lang, "visionEmptyTitle")}</Body>
              <Caption className="text-muted-foreground">{t(lang, "visionLiveEmptySub")}</Caption>
              <div className="mt-3">
                <Link className="text-sm font-medium text-primary underline" to="/office/vision">
                  {t(lang, "visionLiveManageCameras")}
                </Link>
              </div>
            </div>
          </EnterpriseCard>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className={`grid gap-3 ${visionGridClass(effectiveGrid)}`}>
              {visibleCameras.map((cam) => (
                <VisionLiveTile
                  key={cam.id}
                  lang={lang}
                  shopScopeId={shopScopeId}
                  camera={cam}
                  active
                  preferSubstream={preferSub && Boolean(cam.rtspUrlSub)}
                  selected={cam.id === selectedId}
                  onSelect={() => {
                    setSelectedId(cam.id);
                    setSelectedSession(null);
                  }}
                  onSession={(s) => {
                    if (cam.id === selectedId) setSelectedSession(s);
                  }}
                />
              ))}
            </div>
            <VisionCameraDetailsPanel lang={lang} camera={selected} session={selectedSession} />
          </div>
        )}

        {orderedCameras.length > effectiveGrid ? (
          <Caption className="text-muted-foreground">
            {t(lang, "visionLiveShowingN")
              .replace("{shown}", String(visibleCameras.length))
              .replace("{total}", String(orderedCameras.length))}
          </Caption>
        ) : null}

        {!isPhone && orderedCameras.length > 1 ? (
          <EnterpriseCard className="p-3">
            <Caption className="mb-2 block text-muted-foreground">{t(lang, "visionLivePickCamera")}</Caption>
            <div className="flex flex-wrap gap-2">
              {orderedCameras.map((cam) => (
                <WakaButton
                  key={cam.id}
                  type="button"
                  variant={selectedId === cam.id ? "primary" : "secondary"}
                  onClick={() => {
                    setSelectedId(cam.id);
                    setSelectedSession(null);
                  }}
                >
                  {cam.name}
                </WakaButton>
              ))}
            </div>
          </EnterpriseCard>
        ) : null}
      </div>
    </BackOfficePageLayout>
  );
}
