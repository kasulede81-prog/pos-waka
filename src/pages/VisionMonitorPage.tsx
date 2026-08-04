import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, LayoutGrid, MonitorPlay, Search, Star } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { EnterpriseCard } from "../components/enterprise/EnterpriseCard";
import { Body, Caption, SectionTitle } from "../components/enterprise/EnterpriseTypography";
import { WakaButton } from "../components/ui/wakaPrimitives";
import { VisionCameraDetailsPanel } from "../features/vision/components/VisionCameraDetailsPanel";
import { VisionFloorPlanBoard } from "../features/vision/components/VisionFloorPlanBoard";
import { VisionMonitorDashboardPanel } from "../features/vision/components/VisionMonitorDashboard";
import { VisionStatusCenter } from "../features/vision/components/VisionStatusCenter";
import { resolveVisionCardHealth, visionCardHealthLabelKey } from "../features/vision/cameraHealth";
import { getVisionEdgeAgentInfo } from "../features/vision/edgeClient";
import { loadVisionRegistry } from "../features/vision/registry";
import { resolveVisionShopScopeId } from "../features/vision/shopScope";
import type { VisionCamera, VisionEdgeAgentInfo, VisionGridSize } from "../features/vision/types";
import { groupCameras } from "../features/vision/workspace/cameraGroups";
import { buildVisionMonitorDashboard } from "../features/vision/workspace/monitorDashboard";
import {
  filterByBranch,
  filterVisionCameras,
  listVisionBranches,
  sortWithFavorites,
} from "../features/vision/workspace/monitorSearch";
import type { VisionMonitorWorkspace } from "../features/vision/workspace/types";
import {
  DEFAULT_MONITOR_LAYOUTS,
  clearVisionFloorPlan,
  deleteVisionLayout,
  loadVisionWorkspace,
  saveVisionFloorPlan,
  saveVisionLayout,
  setVisionGroupCollapsed,
  setVisionMonitorBranch,
  toggleVisionFavorite,
  updateVisionFloorPins,
} from "../features/vision/workspace/workspaceStore";

export function VisionMonitorPage({ lang }: { lang: Language }) {
  const shopScopeId = resolveVisionShopScopeId();
  const [cameras, setCameras] = useState<VisionCamera[]>([]);
  const [workspace, setWorkspace] = useState<VisionMonitorWorkspace | null>(null);
  const [agent, setAgent] = useState<VisionEdgeAgentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layoutName, setLayoutName] = useState("");
  const [layoutGrid, setLayoutGrid] = useState<VisionGridSize>(4);
  const [isPhone, setIsPhone] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [list, ws, info] = await Promise.all([
      loadVisionRegistry(shopScopeId),
      loadVisionWorkspace(shopScopeId),
      getVisionEdgeAgentInfo(),
    ]);
    setCameras(list);
    setWorkspace(ws);
    setAgent(info);
    setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    setLoading(false);
  }, [shopScopeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onResize = () => setIsPhone(window.innerWidth < 640);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const branchFilter = workspace?.selectedBranch ?? null;
  const favoriteIds = workspace?.favoriteIds ?? [];
  const collapsed = new Set(workspace?.collapsedGroupIds ?? []);

  const branched = useMemo(() => filterByBranch(cameras, branchFilter), [cameras, branchFilter]);
  const searched = useMemo(() => filterVisionCameras(branched, query), [branched, query]);
  const ordered = useMemo(() => sortWithFavorites(searched, favoriteIds), [searched, favoriteIds]);
  const groups = useMemo(() => groupCameras(ordered), [ordered]);
  const branches = useMemo(() => listVisionBranches(cameras), [cameras]);
  const dash = useMemo(() => buildVisionMonitorDashboard(branched, agent), [branched, agent]);
  const selected = cameras.find((c) => c.id === selectedId) ?? null;

  const liveHref = (opts?: { grid?: VisionGridSize; cameraIds?: string[]; camera?: string }) => {
    const params = new URLSearchParams();
    if (opts?.grid) params.set("grid", String(opts.grid));
    if (opts?.cameraIds?.length) params.set("cameras", opts.cameraIds.join(","));
    if (opts?.camera) params.set("camera", opts.camera);
    const q = params.toString();
    return q ? `/office/vision/live?${q}` : "/office/vision/live";
  };

  if (loading || !workspace) {
    return (
      <BackOfficePageLayout
        header={
          <EnterprisePageHeader
            lang={lang}
            title={t(lang, "visionMonTitle")}
            subtitle={t(lang, "visionMonSub")}
            backFallback="/office/vision"
            compact
          />
        }
      >
        <Caption>{t(lang, "visionLoading")}</Caption>
      </BackOfficePageLayout>
    );
  }

  return (
    <BackOfficePageLayout
      header={
        <EnterprisePageHeader
          lang={lang}
          title={t(lang, "visionMonTitle")}
          subtitle={t(lang, "visionMonSub")}
          backFallback="/office/vision"
          compact
        />
      }
    >
      <div className="space-y-4 pb-10">
        <div className="flex flex-wrap gap-2">
          <Link
            to={liveHref({
              grid: isPhone ? 1 : 4,
              cameraIds: ordered.slice(0, isPhone ? 1 : 4).map((c) => c.id),
              camera: selectedId ?? undefined,
            })}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-elev"
          >
            <MonitorPlay className="h-4 w-4" aria-hidden />
            {t(lang, "visionOpenLiveView")}
          </Link>
          <Link
            to="/office/vision"
            className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            {t(lang, "visionLiveManageCameras")}
          </Link>
        </div>

        <VisionMonitorDashboardPanel lang={lang} dash={dash} />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            <EnterpriseCard className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 text-sm"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t(lang, "visionMonSearchPlaceholder")}
                />
              </label>
              <label className="text-sm">
                <Caption className="mb-1 block text-muted-foreground">{t(lang, "visionMonBranch")}</Caption>
                <select
                  className="min-w-[160px] rounded-lg border border-border bg-background px-3 py-2"
                  value={branchFilter ?? ""}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    void setVisionMonitorBranch(shopScopeId, v).then(setWorkspace);
                  }}
                >
                  <option value="">{t(lang, "visionMonAllBranches")}</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
            </EnterpriseCard>

            <VisionFloorPlanBoard
              lang={lang}
              plan={workspace.floorPlan}
              cameras={ordered}
              onUpload={(dataUrl, name) => {
                void saveVisionFloorPlan(shopScopeId, {
                  id: workspace.floorPlan?.id ?? crypto.randomUUID(),
                  name,
                  imageDataUrl: dataUrl,
                  pins: workspace.floorPlan?.pins ?? [],
                }).then(setWorkspace);
              }}
              onPinsChange={(pins) => {
                void updateVisionFloorPins(shopScopeId, pins).then(setWorkspace);
              }}
              onClear={() => {
                void clearVisionFloorPlan(shopScopeId).then(setWorkspace);
              }}
              onSelectCamera={setSelectedId}
            />

            <EnterpriseCard className="space-y-3 p-4">
              <SectionTitle>{t(lang, "visionMonGroupsTitle")}</SectionTitle>
              {ordered.length === 0 ? (
                <Caption className="text-muted-foreground">{t(lang, "visionMonNoCameras")}</Caption>
              ) : (
                <ul className="space-y-2">
                  {groups.map(({ group, cameras: cams }) => {
                    const isCollapsed = collapsed.has(group.id);
                    return (
                      <li key={group.id} className="rounded-xl border border-border/70">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2.5 text-left"
                          onClick={() => {
                            void setVisionGroupCollapsed(shopScopeId, group.id, !isCollapsed).then(setWorkspace);
                          }}
                        >
                          <Body className="font-semibold">
                            {t(lang, group.labelKey)}{" "}
                            <span className="text-muted-foreground">({cams.length})</span>
                          </Body>
                          <Caption className="text-muted-foreground">{isCollapsed ? "+" : "−"}</Caption>
                        </button>
                        {!isCollapsed ? (
                          <ul className="space-y-1 border-t border-border/60 px-2 py-2">
                            {cams.map((cam) => {
                              const fav = favoriteIds.includes(cam.id);
                              const health = resolveVisionCardHealth(cam);
                              return (
                                <li key={cam.id}>
                                  <div
                                    className={`flex items-center gap-2 rounded-lg px-2 py-2 ${
                                      selectedId === cam.id ? "bg-primary/10" : "hover:bg-muted/40"
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      className="min-w-0 flex-1 text-left"
                                      onClick={() => setSelectedId(cam.id)}
                                    >
                                      <Body className="truncate text-sm font-medium">{cam.name}</Body>
                                      <Caption className="text-muted-foreground">
                                        {cam.zoneId.replaceAll("_", " ")}
                                        {cam.assignedPosLabel ? ` · ${cam.assignedPosLabel}` : ""}
                                        {" · "}
                                        {t(lang, visionCardHealthLabelKey(health))}
                                      </Caption>
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={t(lang, "visionMonFavorite")}
                                      className={fav ? "text-amber-500" : "text-muted-foreground"}
                                      onClick={() => {
                                        void toggleVisionFavorite(shopScopeId, cam.id).then(setWorkspace);
                                      }}
                                    >
                                      <Star className={`h-4 w-4 ${fav ? "fill-current" : ""}`} />
                                    </button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </EnterpriseCard>

            <EnterpriseCard className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionTitle>{t(lang, "visionMonLayoutsTitle")}</SectionTitle>
                <LayoutGrid className="h-4 w-4 text-muted-foreground" aria-hidden />
              </div>
              <Caption className="text-muted-foreground">{t(lang, "visionMonLayoutsSub")}</Caption>
              <div className="flex flex-wrap gap-2">
                {DEFAULT_MONITOR_LAYOUTS.map((preset) => (
                  <Link
                    key={preset.nameKey}
                    to={liveHref({
                      grid: isPhone ? 1 : preset.gridSize,
                      cameraIds: ordered.slice(0, isPhone ? 1 : preset.gridSize).map((c) => c.id),
                    })}
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted/40"
                  >
                    {t(lang, preset.nameKey)}
                  </Link>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                <label className="text-sm">
                  <Caption className="text-muted-foreground">{t(lang, "visionMonSaveLayoutName")}</Caption>
                  <input
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                    value={layoutName}
                    onChange={(e) => setLayoutName(e.target.value)}
                    placeholder={t(lang, "visionLayoutCashier")}
                  />
                </label>
                <label className="text-sm">
                  <Caption className="text-muted-foreground">{t(lang, "visionLiveGrid")}</Caption>
                  <select
                    className="mt-1 rounded-lg border border-border bg-background px-3 py-2"
                    value={layoutGrid}
                    onChange={(e) => setLayoutGrid(Number(e.target.value) as VisionGridSize)}
                  >
                    {[1, 2, 4, 9, 16].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <WakaButton
                  type="button"
                  onClick={() => {
                    void saveVisionLayout(shopScopeId, {
                      name: layoutName || t(lang, "visionMonCustomLayout"),
                      gridSize: layoutGrid,
                      cameraIds: ordered.slice(0, layoutGrid).map((c) => c.id),
                    }).then((ws) => {
                      setWorkspace(ws);
                      setLayoutName("");
                    });
                  }}
                >
                  {t(lang, "visionMonSaveLayout")}
                </WakaButton>
              </div>
              {workspace.layouts.length > 0 ? (
                <ul className="space-y-2">
                  {workspace.layouts.map((layout) => (
                    <li
                      key={layout.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2"
                    >
                      <div>
                        <Body className="text-sm font-medium">{layout.name}</Body>
                        <Caption className="text-muted-foreground">
                          {layout.gridSize} · {layout.cameraIds.length} cam
                        </Caption>
                      </div>
                      <div className="flex gap-2">
                        <Link
                          to={liveHref({
                            grid: isPhone ? 1 : layout.gridSize,
                            cameraIds: layout.cameraIds,
                          })}
                          className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {t(lang, "visionMonOpenLayout")}
                        </Link>
                        <button
                          type="button"
                          className="text-sm text-muted-foreground hover:text-rose-600"
                          onClick={() => {
                            void deleteVisionLayout(shopScopeId, layout.id).then(setWorkspace);
                          }}
                        >
                          {t(lang, "visionDelete")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </EnterpriseCard>
          </div>

          <div className={`space-y-4 ${isPhone && !selected ? "hidden" : ""}`}>
            <VisionStatusCenter
              lang={lang}
              cameras={branched}
              dash={dash}
              agent={agent}
              selected={selected}
            />
            <VisionCameraDetailsPanel lang={lang} camera={selected} session={null} />
            {selected ? (
              <Link
                to={liveHref({ grid: 1, camera: selected.id, cameraIds: [selected.id] })}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-muted/40"
              >
                <Camera className="h-4 w-4" aria-hidden />
                {t(lang, "visionMonWatchSelected")}
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </BackOfficePageLayout>
  );
}
