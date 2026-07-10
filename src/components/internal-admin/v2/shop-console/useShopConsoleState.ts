import { useCallback, useEffect, useState } from "react";
import type { Language } from "../../../../types";
import { t } from "../../../../lib/i18n";
import { executeInternalAdminAction } from "../../../../lib/internalAdminActionRunner";
import { adminSetShopPilotCohort } from "../../../../lib/internalOpsHardening";
import {
  INTERNAL_ADMIN_PREVIEW_ROW,
  PREVIEW_SHOP_ID,
  PREVIEW_SHOP_OPS_DETAIL,
} from "../../../../lib/internalAdminPreview";
import {
  fetchShopCloudSnapshotForRescue,
  fetchShopRecoverySignals,
} from "../../../../lib/rescueSupportActions";
import {
  fetchShopAuditTimeline,
  fetchShopOpsDetail,
  fetchWakaInternalAdminMe,
  type OpsAuditRow,
  type ShopOpsDetail,
  type WakaInternalAdminRow,
} from "../../../../lib/wakaInternalAdmin";
import {
  parseRescueDiagnosticsJson,
  type ParsedRescueDiagnostics,
} from "../../../../lib/rescueDiagnosticsParse";
import type { RescueAuditFilters } from "../../../../lib/rescueConsoleIntel";
import { supabase } from "../../../../lib/supabase";
import { adminPermissions } from "../adminRoles";

export type ShopConsoleRescueState = {
  auditRows: OpsAuditRow[];
  recoverySignals: { clearBackOfficePinAt: string | null; passwordResetRequestedAt: string | null };
  cloudSnapshot: unknown;
  diagnostics: ParsedRescueDiagnostics | null;
  importText: string;
  auditFilters: RescueAuditFilters;
  showAllDevices: boolean;
  loaded: boolean;
};

const DEFAULT_AUDIT_FILTERS: RescueAuditFilters = {
  query: "",
  dateFrom: "",
  dateTo: "",
  user: "all",
  category: "all",
  severity: "all",
};

export type ExecuteShopActionOptions = {
  confirm?: string;
  permitted?: boolean;
  permissionDeniedMessage?: string;
  skipAudit?: boolean;
  skipRefresh?: boolean;
};

export function useShopConsoleState(
  lang: Language,
  shopId: string | undefined,
  previewRequested: boolean,
) {
  const [adminRow, setAdminRow] = useState<WakaInternalAdminRow | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [detail, setDetail] = useState<ShopOpsDetail | null>(null);
  const [loadingShop, setLoadingShop] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [auditRowsLight, setAuditRowsLight] = useState<OpsAuditRow[]>([]);
  const [pilotCohort, setPilotCohort] = useState(false);
  const [importedPending, setImportedPending] = useState<number | null>(null);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportBody, setSupportBody] = useState("");
  const [rescue, setRescue] = useState<ShopConsoleRescueState>({
    auditRows: [],
    recoverySignals: { clearBackOfficePinAt: null, passwordResetRequestedAt: null },
    cloudSnapshot: null,
    diagnostics: null,
    importText: "",
    auditFilters: DEFAULT_AUDIT_FILTERS,
    showAllDevices: false,
    loaded: false,
  });

  const effectivePreviewMode = previewRequested && (loadingAdmin || !adminRow);

  const loadShop = useCallback(async () => {
    if (!shopId) return;
    setLoadingShop(true);
    if (effectivePreviewMode) {
      setDetail(
        shopId === PREVIEW_SHOP_ID || shopId.startsWith("preview-")
          ? PREVIEW_SHOP_OPS_DETAIL
          : {
              ...PREVIEW_SHOP_OPS_DETAIL,
              shop: {
                ...PREVIEW_SHOP_OPS_DETAIL.shop,
                id: shopId,
                name: `${PREVIEW_SHOP_OPS_DETAIL.shop.name} (${shopId})`,
              },
            },
      );
      setLoadingShop(false);
      return;
    }
    const d = await fetchShopOpsDetail(shopId);
    setDetail(d);
    setLoadingShop(false);
  }, [shopId, effectivePreviewMode]);

  const loadRescueData = useCallback(async () => {
    if (!shopId || rescue.loaded) return;
    if (effectivePreviewMode) {
      setRescue((prev) => ({ ...prev, auditRows: [], loaded: true }));
      return;
    }
    const [audit, signals, snap] = await Promise.all([
      fetchShopAuditTimeline(shopId, 80),
      fetchShopRecoverySignals(shopId),
      fetchShopCloudSnapshotForRescue(shopId),
    ]);
    setRescue((prev) => ({
      ...prev,
      auditRows: audit,
      recoverySignals: signals,
      cloudSnapshot: snap?.snapshot ?? null,
      loaded: true,
    }));
  }, [shopId, effectivePreviewMode, rescue.loaded]);

  const refreshAudit = useCallback(async () => {
    if (!shopId || effectivePreviewMode) return;
    const rows = await fetchShopAuditTimeline(shopId, 80);
    setRescue((prev) => ({ ...prev, auditRows: rows }));
    setAuditRowsLight(await fetchShopAuditTimeline(shopId, 20));
  }, [shopId, effectivePreviewMode]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const row = await fetchWakaInternalAdminMe();
      if (!cancelled) {
        setAdminRow(row);
        setLoadingAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadShop();
  }, [loadShop]);

  useEffect(() => {
    if (!shopId || effectivePreviewMode) {
      setAuditRowsLight([]);
      return;
    }
    void fetchShopAuditTimeline(shopId, 20).then(setAuditRowsLight);
  }, [shopId, effectivePreviewMode]);

  useEffect(() => {
    if (!shopId || effectivePreviewMode || !supabase) return;
    void supabase
      .from("shops")
      .select("pilot_cohort")
      .eq("id", shopId)
      .maybeSingle()
      .then(({ data }) => setPilotCohort(Boolean(data?.pilot_cohort)));
  }, [shopId, effectivePreviewMode]);

  const shellAdmin = effectivePreviewMode ? INTERNAL_ADMIN_PREVIEW_ROW : adminRow;
  const perms = adminPermissions(adminRow);
  const canSupport = perms.canShopSupport;
  const canSubs = perms.canShopSubs;
  const subId = detail?.subscription?.id;

  const refreshAfterAction = useCallback(async () => {
    await loadShop();
    await refreshAudit();
  }, [loadShop, refreshAudit]);

  const executeAction = useCallback(
    async (
      action: string,
      fn: () => Promise<{ ok: boolean; message?: string }>,
      opts: ExecuteShopActionOptions = {},
    ) => {
      return executeInternalAdminAction(
        {
          previewMode: effectivePreviewMode,
          previewBlockedMessage: t(lang, "internalAdminPreviewActionBlocked"),
          permitted: opts.permitted ?? true,
          permissionDeniedMessage: opts.permissionDeniedMessage,
          confirmMessage: opts.confirm,
          skipAudit: opts.skipAudit,
          setBusy,
          onSuccess: () => setToast({ kind: "ok", text: t(lang, "internalShopProfileDone") }),
          onError: (msg) => setToast({ kind: "err", text: msg }),
          refresh: opts.skipRefresh ? undefined : refreshAfterAction,
          audit: shopId ? { action, shopId } : { action, shopId: null },
        },
        fn,
      );
    },
    [effectivePreviewMode, lang, refreshAfterAction, shopId],
  );

  /** @deprecated Use executeAction — kept for gradual migration */
  const run = useCallback(
    (fn: () => Promise<{ ok: boolean; message?: string }>) =>
      executeAction("admin_shop_action", fn),
    [executeAction],
  );

  const setRescueField = <K extends keyof ShopConsoleRescueState>(key: K, value: ShopConsoleRescueState[K]) => {
    setRescue((prev) => ({ ...prev, [key]: value }));
  };

  const loadImport = (raw: string) => {
    setRescueField("importText", raw);
    setRescueField("diagnostics", parseRescueDiagnosticsJson(raw));
  };

  const togglePilotCohort = async (next: boolean) => {
    if (!detail) return;
    await executeAction(
      "admin_set_pilot_cohort",
      () => adminSetShopPilotCohort(detail.shop.id, next),
      { permitted: canSupport, confirm: next ? "Add shop to pilot cohort?" : "Remove shop from pilot cohort?" },
    ).then((r) => {
      if (r.ok) setPilotCohort(next);
    });
  };

  return {
    lang,
    shopId,
    previewMode: effectivePreviewMode,
    adminRow: shellAdmin,
    loadingAdmin,
    detail,
    loadingShop,
    busy,
    setBusy,
    toast,
    setToast,
    auditRowsLight,
    pilotCohort,
    togglePilotCohort,
    importedPending,
    setImportedPending,
    supportSubject,
    setSupportSubject,
    supportBody,
    setSupportBody,
    perms,
    canSupport,
    canSubs,
    subId,
    loadShop,
    loadRescueData,
    refreshAudit,
    run,
    executeAction,
    rescue,
    setRescueField,
    loadImport,
  };
}

export type ShopConsoleState = ReturnType<typeof useShopConsoleState>;
