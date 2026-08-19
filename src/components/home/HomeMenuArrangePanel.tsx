import { useCallback, useMemo, useState, type PointerEvent, type ReactNode } from "react";
import { actorHasEffectivePermission } from "../../lib/actorAuthorization";
import clsx from "clsx";
import type { Language, LauncherTileConfig, Permission } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useShelfDragReorder } from "../../hooks/useShelfDragReorder";
import { resolveHomeMenuTiles, updateLauncherTileLayout, type ResolvedHomeTile } from "../../lib/launcherTiles";
import {
  applyHomeBandOrder,
  HOME_MODULE_GRID_CLASS,
  HOME_MODULE_SECTION_SPACING,
  presentHomeMenuTiles,
  visibleHomeRegionOrder,
  type HomeBodyRegionId,
} from "../../lib/homePresentation";
import { isPharmacyMode } from "../../lib/pharmacy";
import { HOME_HERO_PREVIEW_BG_PRESETS, PRESET_SHELF_HEX, resolveHomeHeroPreviewBgColor } from "../../lib/shelfColor";
import { HOME_TILE_ACCENT_PRESETS, resolveHomeTileAccent } from "../../lib/homeTileAccent";
import { useSessionActor } from "../../context/SessionActorContext";
import { useSubscription } from "../../context/SubscriptionContext";
import { WakaSwitch } from "../enterprise/WakaSwitch";
import { HomeBusinessHero } from "./HomeBusinessHero";
import { HomeReportsPreview } from "./HomeReportsPreview";
import { LivingDashboardCard } from "./LivingDashboardCard";
import { HomeOrderedRegions } from "./HomeOrderedRegions";
import { useHomeRegionLayout } from "../../hooks/useHomeRegionLayout";
import { ShelfColorWheel } from "../pos/ShelfColorWheel";
import { Caption, SectionTitle } from "../enterprise/EnterpriseTypography";

const EMPTY_ORDER: string[] = [];
const EMPTY_LAYOUT: Record<string, LauncherTileConfig> = {};

type Props = {
  lang: Language;
  embedded?: boolean;
};

function ArrangeChrome({
  tileId,
  dragAttr,
  selected,
  hidden,
  dragging,
  dragOver,
  hiddenLabel,
  children,
}: {
  tileId: string;
  dragAttr?: string;
  selected: boolean;
  hidden: boolean;
  dragging: boolean;
  dragOver: boolean;
  hiddenLabel: string;
  children: ReactNode;
}) {
  return (
    <div
      className={clsx(
        "relative rounded-2xl",
        selected && "ring-2 ring-waka-500 ring-offset-2",
        dragging && "z-20 scale-[1.02] opacity-90 shadow-lg",
        dragOver && "ring-2 ring-dashed ring-waka-400",
        hidden && "opacity-45",
      )}
      {...(dragAttr ? { [dragAttr]: tileId } : {})}
    >
      {hidden ? (
        <span className="pointer-events-none absolute left-2 top-2 z-10 rounded-full bg-foreground/80 px-2 py-0.5 text-[10px] font-bold text-background">
          {hiddenLabel}
        </span>
      ) : null}
      {children}
    </div>
  );
}

export function HomeMenuArrangePanel({ lang, embedded = false }: Props) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const preferences = usePosStore((s) => s.preferences);
  const savedOrderRaw = usePosStore((s) => s.preferences.launcherTileOrder);
  const layoutRaw = usePosStore((s) => s.preferences.launcherTileLayout);
  const previewBgStored = usePosStore((s) => s.preferences.homeHeroPreviewBgColor);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const savedOrder = savedOrderRaw ?? EMPTY_ORDER;
  const layout = layoutRaw ?? EMPTY_LAYOUT;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { largeScreen } = useHomeRegionLayout();

  const can = useCallback(
    (perm?: Permission) =>
      !perm || actorHasEffectivePermission(actor, perm, snapshot, authMode),
    [actor, snapshot, authMode],
  );

  const { hero, secondary } = useMemo(
    () =>
      resolveHomeMenuTiles({
        savedOrder,
        layout,
        hasPermission: can,
        includeHidden: true,
        pharmacyMode,
      }),
    [savedOrder, layout, can, pharmacyMode],
  );

  const presentation = useMemo(() => presentHomeMenuTiles({ hero, secondary }), [hero, secondary]);
  const fullOrderIds = useMemo(() => secondary.map((tile) => tile.id), [secondary]);

  const persistBandOrder = useCallback(
    (nextBand: string[]) => {
      setPreferences({ launcherTileOrder: applyHomeBandOrder(fullOrderIds, nextBand) });
    },
    [fullOrderIds, setPreferences],
  );

  const primaryIds = useMemo(() => presentation.primary.map((tile) => tile.id), [presentation.primary]);
  const secondaryIds = useMemo(
    () => presentation.secondary.map((tile) => tile.id),
    [presentation.secondary],
  );
  const adminIds = useMemo(() => presentation.admin.map((tile) => tile.id), [presentation.admin]);

  const primaryDrag = useShelfDragReorder(primaryIds, persistBandOrder, "data-home-primary-key");
  const secondaryDrag = useShelfDragReorder(secondaryIds, persistBandOrder, "data-home-secondary-key");
  const adminDrag = useShelfDragReorder(adminIds, persistBandOrder, "data-home-admin-key");

  const selectedTile = selectedId
    ? [presentation.reports, ...presentation.primary, ...presentation.secondary, ...presentation.admin].find(
        (tile) => tile?.id === selectedId,
      )
    : null;

  const patchSelected = useCallback(
    (patch: Partial<LauncherTileConfig>) => {
      if (!selectedId) return;
      setPreferences({ launcherTileLayout: updateLauncherTileLayout(layout, selectedId, patch) });
    },
    [selectedId, setPreferences, layout],
  );

  const selectTile = useCallback(
    (id: string, ignoreClick: () => boolean) => {
      if (ignoreClick()) return;
      setSelectedId((current) => (current === id ? null : id));
    },
    [],
  );

  const previewBgHex = resolveHomeHeroPreviewBgColor(previewBgStored);
  const selectedAccentHex = selectedTile ? resolveHomeTileAccent(selectedTile).hex : PRESET_SHELF_HEX.default;
  const selectedUsesCustom = Boolean(selectedTile?.customColor);

  const renderArrangeCard = (
    tile: ResolvedHomeTile,
    density: "comfortable" | "compact",
    drag: {
      dragKey: string | null;
      overKey: string | null;
      startDrag: (key: string, e: PointerEvent<HTMLButtonElement>) => void;
      shouldIgnoreClick: () => boolean;
    },
    dragAttr: string,
  ) => (
    <ArrangeChrome
      key={tile.id}
      tileId={tile.id}
      dragAttr={dragAttr}
      selected={selectedId === tile.id}
      hidden={tile.hidden}
      dragging={drag.dragKey === tile.id}
      dragOver={drag.overKey === tile.id && drag.dragKey !== tile.id}
      hiddenLabel={t(lang, "homeMenuTileHidden")}
    >
      <LivingDashboardCard
        tile={tile}
        lang={lang}
        spotlight={false}
        appearance="enterprise"
        density={density}
        onClick={() => selectTile(tile.id, drag.shouldIgnoreClick)}
        onPointerDown={(e) => drag.startDrag(tile.id, e)}
      />
    </ArrangeChrome>
  );

  const content = (
    <div className="space-y-4">
      <p className="text-sm font-medium text-muted-foreground">{t(lang, "homeMenuArrangeSub")}</p>

      <section className="space-y-3 rounded-2xl border-2 border-border bg-card p-4">
        <div>
          <p className="text-sm font-bold text-foreground">{t(lang, "homeMenuPreviewBgTitle")}</p>
          <p className="mt-0.5 text-xs font-medium text-muted-foreground">{t(lang, "homeMenuPreviewBgSub")}</p>
        </div>
        <div>
          <p className="text-xs font-bold text-muted-foreground">{t(lang, "homeMenuColorLabel")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {HOME_HERO_PREVIEW_BG_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setPreferences({ homeHeroPreviewBgColor: preset.hex })}
                className={clsx(
                  "h-9 min-w-[3rem] rounded-xl border-2 px-2 text-xs font-black capitalize",
                  previewBgHex === preset.hex ? "border-waka-600 ring-2 ring-waka-200" : "border-border",
                )}
                style={{ backgroundColor: preset.hex }}
                aria-label={preset.id}
              />
            ))}
          </div>
          <ShelfColorWheel
            className="mt-3"
            value={previewBgHex}
            onChange={(hex) => setPreferences({ homeHeroPreviewBgColor: hex ?? null })}
          />
        </div>
      </section>

      <HomeOrderedRegions
        order={visibleHomeRegionOrder({
          largeScreen,
          hasHero: Boolean(presentation.hero),
          hasKpis: false,
          hasHealth: false,
          hasPrimary: presentation.primary.length > 0,
          hasReports: Boolean(presentation.reports),
          hasOperations: presentation.secondary.length > 0,
          hasAdmin: presentation.admin.length > 0,
        })}
        packExecutiveScan={false}
        renderRegion={(id: HomeBodyRegionId) => {
          switch (id) {
            case "hero":
              return presentation.hero ? (
                <section className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {t(lang, "homeMenuSellLocked")}
                  </p>
                  <ArrangeChrome
                    tileId="sell"
                    selected={false}
                    hidden={false}
                    dragging={false}
                    dragOver={false}
                    hiddenLabel={t(lang, "homeMenuTileHidden")}
                  >
                    <HomeBusinessHero
                      lang={lang}
                      onSell={() => undefined}
                      heroActionLabelKey={pharmacyMode ? "builderHomeTapDispense" : "builderHomeTapSell"}
                    />
                  </ArrangeChrome>
                </section>
              ) : null;
            case "reports":
              return presentation.reports ? (
                <section className={HOME_MODULE_SECTION_SPACING.standard}>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {t(lang, "homeMenuReportsLocked")}
                  </p>
                  <ArrangeChrome
                    tileId={presentation.reports.id}
                    selected={selectedId === presentation.reports.id}
                    hidden={presentation.reports.hidden}
                    dragging={false}
                    dragOver={false}
                    hiddenLabel={t(lang, "homeMenuTileHidden")}
                  >
                    <HomeReportsPreview
                      lang={lang}
                      tile={presentation.reports}
                      onOpen={() => selectTile(presentation.reports!.id, () => false)}
                    />
                  </ArrangeChrome>
                </section>
              ) : null;
            case "primary":
              return presentation.primary.length > 0 ? (
                <section className={HOME_MODULE_SECTION_SPACING.standard}>
                  <SectionTitle as="h2" className="mb-2 !text-sm sm:!text-base">
                    {t(lang, "homeModulesPrimary")}
                  </SectionTitle>
                  <div className={HOME_MODULE_GRID_CLASS.comfortable}>
                    {presentation.primary.map((tile) =>
                      renderArrangeCard(tile, "comfortable", primaryDrag, "data-home-primary-key"),
                    )}
                  </div>
                </section>
              ) : null;
            case "operations":
              return presentation.secondary.length > 0 ? (
                <section className={HOME_MODULE_SECTION_SPACING.standard}>
                  <SectionTitle as="h2" className="mb-2 !text-sm sm:!text-base">
                    {t(lang, "homeModulesSecondary")}
                  </SectionTitle>
                  <Caption className="mb-2 normal-case">{t(lang, "homeModulesSecondarySub")}</Caption>
                  <div className={HOME_MODULE_GRID_CLASS.comfortable}>
                    {presentation.secondary.map((tile) =>
                      renderArrangeCard(tile, "comfortable", secondaryDrag, "data-home-secondary-key"),
                    )}
                  </div>
                </section>
              ) : null;
            case "admin":
              return presentation.admin.length > 0 ? (
                <section className={HOME_MODULE_SECTION_SPACING.admin}>
                  <SectionTitle as="h2" className="mb-2 !text-sm sm:!text-base">
                    {t(lang, "homeModulesAdmin")}
                  </SectionTitle>
                  <div className={HOME_MODULE_GRID_CLASS.compact}>
                    {presentation.admin.map((tile) =>
                      renderArrangeCard(tile, "compact", adminDrag, "data-home-admin-key"),
                    )}
                  </div>
                </section>
              ) : null;
            default:
              return null;
          }
        }}
      />

      {selectedId && selectedTile ? (
        <section className="space-y-3 rounded-2xl border-2 border-waka-200 bg-card p-4">
          <p className="text-sm font-bold text-foreground">
            {t(lang, "homeMenuEditHeading")}: {t(lang, selectedTile.labelKey)}
          </p>
          {selectedTile.hideable ? (
            <WakaSwitch
              checked={!selectedTile.hidden}
              onCheckedChange={(checked) => patchSelected({ hidden: !checked })}
              label={selectedTile.hidden ? t(lang, "homeMenuShowTile") : t(lang, "homeMenuHideTile")}
              className="text-sm font-bold text-foreground"
            />
          ) : null}

          <div>
            <p className="text-xs font-bold text-muted-foreground">{t(lang, "homeMenuTileAccentLabel")}</p>
            <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">{t(lang, "homeMenuTileAccentHint")}</p>
            <div
              className="mt-2 h-8 w-full rounded-lg border border-border"
              style={{ backgroundColor: selectedAccentHex }}
              aria-hidden
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {HOME_TILE_ACCENT_PRESETS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => patchSelected({ color, customColor: null })}
                  className={clsx(
                    "h-9 min-w-[3rem] rounded-xl border-2 px-2 text-xs font-black capitalize",
                    !selectedUsesCustom && (selectedTile.color ?? "default") === color
                      ? "border-waka-600 ring-2 ring-waka-200"
                      : "border-border",
                  )}
                  style={{ backgroundColor: PRESET_SHELF_HEX[color] }}
                  aria-label={color}
                >
                  {color === "default" ? "—" : ""}
                </button>
              ))}
            </div>
            <ShelfColorWheel
              className="mt-3"
              value={selectedAccentHex}
              onChange={(hex) => {
                if (hex) patchSelected({ customColor: hex });
                else patchSelected({ customColor: undefined, color: "default" });
              }}
            />
          </div>
        </section>
      ) : null}
    </div>
  );

  if (embedded) return content;

  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-base font-bold text-foreground">{t(lang, "homeMenuArrangeTitle")}</p>
      <div className="mt-4">{content}</div>
    </article>
  );
}
