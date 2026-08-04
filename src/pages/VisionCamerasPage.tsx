import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { HardDrive, LayoutDashboard, Loader2, MonitorPlay, Network, Plus, Radar } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { EnterpriseCard } from "../components/enterprise/EnterpriseCard";
import { Body, Caption, SectionTitle } from "../components/enterprise/EnterpriseTypography";
import { WakaButton } from "../components/ui/wakaPrimitives";
import { VisionCameraTestPanel } from "../features/vision/components/VisionCameraTestPanel";
import { VisionCameraRegistryCard } from "../features/vision/components/VisionCameraRegistryCard";
import { VisionHardwareRecommendations } from "../features/vision/components/VisionHardwareRecommendations";
import { VisionInstallerDashboard } from "../features/vision/components/VisionInstallerDashboard";
import { VisionRecorderCard } from "../features/vision/components/VisionRecorderCard";
import { VisionSourceWizard, type VisionSourceChoice } from "../features/vision/components/VisionSourceWizard";
import { VisionLicenseStatusStrip } from "../components/vision/VisionLicenseGate";
import { useShopVisionSettings } from "../hooks/useShopVisionSettings";
import {
  wouldExceedVisionCameraLimit,
  wouldExceedVisionDvrLimit,
} from "../lib/vision/canUseVision";
import { scanVisionNetwork } from "../features/vision/discovery";
import {
  importNvrChannels,
  nvrChannelsToCandidates,
  VISION_NVR_VENDORS,
  type VisionNvrVendor,
} from "../features/vision/nvrImport";
import { buildRtspUrl, parseManualRtspUrl } from "../features/vision/manualRtsp";
import { suggestVisionCameraProfiles } from "../features/vision/profiles";
import {
  buildRecorderFocusedInstallerSnapshot,
  buildVisionRecorders,
  type VisionRecorderMetaMap,
} from "../features/vision/recorders";
import { loadVisionRecorderMeta, upsertVisionRecorderMeta } from "../features/vision/recorderStore";
import {
  deleteVisionCamera,
  loadVisionRegistry,
  saveVisionCamera,
  saveVisionCameraFromDiscovery,
  saveVisionCamerasFromDiscoveryBulk,
  updateVisionCameraTestMeta,
} from "../features/vision/registry";
import { resolveVisionShopScopeId } from "../features/vision/shopScope";
import { testSavedVisionCamera, testVisionRtspTarget } from "../features/vision/cameraTest";
import { getVisionEdgeAgentInfo } from "../features/vision/edgeClient";
import { VISION_ZONE_OPTIONS, defaultZoneForProfile } from "../features/vision/zones";
import type {
  VisionCamera,
  VisionCameraProfileId,
  VisionCameraTestResult,
  VisionDiscoveredCandidate,
  VisionEdgeAgentInfo,
  VisionRecordingMode,
  VisionZoneId,
} from "../features/vision/types";

type AddMode = null | "scan" | "manual" | "nvr" | "edit";
type ScanPhase = "idle" | "agent" | "discover" | "collect";

function looksLikeRecorder(c: VisionDiscoveredCandidate): boolean {
  const hay = `${c.name ?? ""} ${c.brand ?? ""} ${c.model ?? ""}`.toLowerCase();
  return c.source === "nvr_import" || /\bnvr\b|\bdvr\b|recorder/.test(hay);
}

export function VisionCamerasPage({ lang }: { lang: Language }) {
  const preferences = usePosStore((s) => s.preferences);
  const shopScopeId = resolveVisionShopScopeId();
  const { access: visionAccess } = useShopVisionSettings();
  const profiles = useMemo(
    () =>
      suggestVisionCameraProfiles(
        preferences.businessType,
        preferences.pharmacyModeEnabled,
        preferences.hospitalityModeEnabled,
      ),
    [preferences.businessType, preferences.pharmacyModeEnabled, preferences.hospitalityModeEnabled],
  );

  const [cameras, setCameras] = useState<VisionCamera[]>([]);
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState<VisionEdgeAgentInfo | null>(null);
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [scanning, setScanning] = useState(false);
  const [scanPhase, setScanPhase] = useState<ScanPhase>("idle");
  const [scanDemo, setScanDemo] = useState(false);
  const [candidates, setCandidates] = useState<VisionDiscoveredCandidate[]>([]);
  const [selected, setSelected] = useState<VisionDiscoveredCandidate | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [zoneId, setZoneId] = useState<VisionZoneId>("checkout");
  const [profileId, setProfileId] = useState<VisionCameraProfileId>("cashier");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [recordingMode, setRecordingMode] = useState<VisionRecordingMode>("dvr");
  const [assignedPos, setAssignedPos] = useState("");
  const [branchLabel, setBranchLabel] = useState("Main Shop");
  const [manualHost, setManualHost] = useState("");
  const [manualPort, setManualPort] = useState("554");
  const [manualPath, setManualPath] = useState("/Streaming/Channels/101");
  const [nvrVendor, setNvrVendor] = useState<VisionNvrVendor>("hikvision");
  const [nvrHost, setNvrHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<VisionCameraTestResult | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [testByCamera, setTestByCamera] = useState<Record<string, VisionCameraTestResult>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recorderMeta, setRecorderMeta] = useState<VisionRecorderMetaMap>({});
  const [selectedRecorderId, setSelectedRecorderId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [list, info, meta] = await Promise.all([
      loadVisionRegistry(shopScopeId),
      getVisionEdgeAgentInfo(),
      loadVisionRecorderMeta(shopScopeId),
    ]);
    setCameras(list);
    setAgent(info);
    setRecorderMeta(meta);
    setLoading(false);
  }, [shopScopeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const recorders = useMemo(() => buildVisionRecorders(cameras, recorderMeta), [cameras, recorderMeta]);
  const installerSnapshot = useMemo(
    () => buildRecorderFocusedInstallerSnapshot(cameras, agent, recorderMeta),
    [cameras, agent, recorderMeta],
  );
  const selectedRecorder = recorders.find((r) => r.id === selectedRecorderId) ?? recorders[0] ?? null;
  const visibleRegistryCameras = selectedRecorder?.cameras ?? [];

  useEffect(() => {
    if (!selectedRecorderId && recorders[0]) setSelectedRecorderId(recorders[0].id);
    if (selectedRecorderId && !recorders.some((r) => r.id === selectedRecorderId)) {
      setSelectedRecorderId(recorders[0]?.id ?? null);
    }
  }, [recorders, selectedRecorderId]);

  const resetWizard = () => {
    setAddMode(null);
    setCandidates([]);
    setSelected(null);
    setSelectedIds(new Set());
    setName("");
    setLocationLabel("");
    setPassword("");
    setAssignedPos("");
    setBranchLabel("Main Shop");
    setError(null);
    setTestResult(null);
    setScanDemo(false);
    setScanPhase("idle");
    setEditingId(null);
  };

  const applyProfile = (id: VisionCameraProfileId) => {
    setProfileId(id);
    setZoneId(defaultZoneForProfile(id));
    const suggestion = profiles.find((p) => p.id === id);
    if (suggestion && !locationLabel.trim()) {
      setLocationLabel(t(lang, suggestion.locationHintKey));
    }
    if (suggestion && !name.trim()) {
      setName(t(lang, suggestion.nameKey));
    }
  };

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setSelected(null);
    setSelectedIds(new Set());
    setScanPhase("agent");
    const phaseTimer = window.setTimeout(() => setScanPhase("discover"), 250);
    const collectTimer = window.setTimeout(() => setScanPhase("collect"), 900);
    const result = await scanVisionNetwork({ allowDemoFallback: true });
    window.clearTimeout(phaseTimer);
    window.clearTimeout(collectTimer);
    setAgent(result.agent);
    setCandidates(result.cameras);
    setScanDemo(result.usedDemoFallback);
    setScanPhase("idle");
    setScanning(false);
  };

  const openScan = async () => {
    setAddMode("scan");
    setCandidates([]);
    await runScan();
  };

  const chooseSource = (choice: VisionSourceChoice) => {
    if (choice === "nvr") {
      setAddMode("nvr");
      setRecordingMode("dvr");
      return;
    }
    if (choice === "manual") {
      setAddMode("manual");
      applyProfile(profiles[0]?.id ?? "cashier");
      return;
    }
    setRecordingMode("nvr");
    void openScan();
  };

  const selectCandidate = (c: VisionDiscoveredCandidate) => {
    setSelected(c);
    setName(c.name || c.ip);
    if (!locationLabel) setLocationLabel(t(lang, "visionZoneCheckout"));
    setTestResult(null);
  };

  const toggleCandidateId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveSelected = async () => {
    if (!selected || !name.trim() || !locationLabel.trim()) {
      setError(t(lang, "visionSaveValidation"));
      return;
    }
    if (wouldExceedVisionCameraLimit(visionAccess, cameras.length, 1)) {
      setError(t(lang, "visionLicCameraLimit"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const row = await saveVisionCameraFromDiscovery({
        shopScopeId,
        candidate: selected,
        name,
        locationLabel,
        zoneId,
        profileId,
        username,
        password: password || undefined,
        recordingMode,
        assignedPosLabel: assignedPos.trim() || null,
        branchLabel: branchLabel.trim() || null,
        nvrHost: selected.source === "nvr_import" ? nvrHost.trim() || selected.ip : null,
      });
      await refresh();
      setActiveId(row.id);
      resetWizard();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "visionSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const importBulk = async (all: boolean) => {
    const list = all
      ? candidates
      : candidates.filter((c) => selectedIds.has(c.discoveryId));
    if (list.length === 0) {
      setError(t(lang, "visionSaveValidation"));
      return;
    }
    if (wouldExceedVisionCameraLimit(visionAccess, cameras.length, list.length)) {
      setError(t(lang, "visionLicCameraLimit"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveVisionCamerasFromDiscoveryBulk({
        shopScopeId,
        candidates: list,
        zoneId,
        profileId,
        username,
        password: password || undefined,
        recordingMode,
        assignedPosLabel: assignedPos.trim() || null,
        branchLabel: branchLabel.trim() || null,
        nvrHost: nvrHost.trim() || null,
        namePrefix: t(lang, "visionProfileStore"),
      });
      await refresh();
      resetWizard();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "visionSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const saveManual = async () => {
    const built = buildRtspUrl({
      host: manualHost,
      port: Number(manualPort) || 554,
      username,
      password,
      path: manualPath,
    });
    const parsed = parseManualRtspUrl(built);
    if (!parsed.ok) {
      setError(t(lang, parsed.errorKey));
      return;
    }
    if (!name.trim() || !locationLabel.trim()) {
      setError(t(lang, "visionSaveValidation"));
      return;
    }
    if (wouldExceedVisionCameraLimit(visionAccess, cameras.length, 1)) {
      setError(t(lang, "visionLicCameraLimit"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const row = await saveVisionCamera({
        shopScopeId,
        name,
        locationLabel,
        zoneId,
        profileId,
        ip: parsed.host,
        rtspUrlMain: parsed.rtspUrl,
        username,
        password: password || undefined,
        recordingMode,
        assignedPosLabel: assignedPos.trim() || null,
        branchLabel: branchLabel.trim() || null,
        onvifSupported: null,
        status: "unknown",
      });
      await refresh();
      setActiveId(row.id);
      resetWizard();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "visionSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editingId || !name.trim() || !locationLabel.trim()) {
      setError(t(lang, "visionSaveValidation"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveVisionCamera({
        shopScopeId,
        id: editingId,
        name,
        locationLabel,
        zoneId,
        profileId,
        recordingMode,
        assignedPosLabel: assignedPos.trim() || null,
        branchLabel: branchLabel.trim() || null,
        username: username || undefined,
        password: password || undefined,
      });
      await refresh();
      resetWizard();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "visionSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const runNvrImport = async () => {
    if (!nvrHost.trim()) {
      setError(t(lang, "visionDvrHostRequired"));
      return;
    }
    const existingHosts = new Set(cameras.map((c) => c.nvrHost).filter(Boolean));
    if (!existingHosts.has(nvrHost.trim()) && wouldExceedVisionDvrLimit(visionAccess, existingHosts.size, 1)) {
      setError(t(lang, "visionLicDvrLimit"));
      return;
    }
    setBusy(true);
    setError(null);
    const r = await importNvrChannels({
      vendor: nvrVendor,
      host: nvrHost.trim(),
      username,
      password,
      allowDemoFallback: true,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setScanDemo(r.usedDemoFallback);
    const host = nvrHost.trim();
    const mapped = nvrChannelsToCandidates(r.channels, nvrVendor, host);
    const brand =
      nvrVendor === "hikvision"
        ? "Hikvision"
        : nvrVendor === "dahua"
          ? "Dahua"
          : nvrVendor === "uniview"
            ? "Uniview"
            : nvrVendor === "tplink_vigi"
              ? "TP-Link VIGI"
              : nvrVendor === "reolink"
                ? "Reolink"
                : "ONVIF";
    const meta = await upsertVisionRecorderMeta(shopScopeId, host, {
      displayName: `${brand} DVR`,
      brand,
      model: "DVR / NVR",
      capacityLabel: "On DVR HDD",
      hddStatus: "ok",
    });
    setRecorderMeta(meta);
    setSelectedRecorderId(host);
    setCandidates(mapped);
    setSelectedIds(new Set(mapped.map((c) => c.discoveryId)));
    setRecordingMode("dvr");
    setAddMode("scan");
  };

  const runTestDraft = async () => {
    setBusy(true);
    setError(null);
    let rtspUrl = selected?.rtspHint ?? null;
    if (addMode === "manual") {
      rtspUrl = buildRtspUrl({
        host: manualHost,
        port: Number(manualPort) || 554,
        username,
        password,
        path: manualPath,
      });
    }
    if (!rtspUrl) {
      setError(t(lang, "visionRtspInvalidUrl"));
      setBusy(false);
      return;
    }
    const result = await testVisionRtspTarget({
      rtspUrl,
      username,
      password,
      onvifXAddr: selected?.onvifXAddr,
    });
    setTestResult(result);
    setBusy(false);
  };

  const runTestSaved = async (camera: VisionCamera) => {
    setBusy(true);
    setActiveId(camera.id);
    const result = await testSavedVisionCamera(shopScopeId, camera);
    setTestResult(result);
    setTestByCamera((prev) => ({ ...prev, [camera.id]: result }));
    await updateVisionCameraTestMeta(shopScopeId, camera.id, {
      status: result.online ? "online" : "offline",
      lastTestAt: result.testedAt,
      lastSeenAt: result.online ? result.testedAt : camera.lastSeenAt,
      onvifSupported: result.onvifSupported,
    });
    await refresh();
    setBusy(false);
  };

  const removeCamera = async (camera: VisionCamera) => {
    if (!window.confirm(t(lang, "visionDeleteConfirm"))) return;
    await deleteVisionCamera(shopScopeId, camera.id);
    if (activeId === camera.id) {
      setActiveId(null);
      setTestResult(null);
    }
    await refresh();
  };

  const openEdit = (camera: VisionCamera) => {
    setEditingId(camera.id);
    setAddMode("edit");
    setName(camera.name);
    setLocationLabel(camera.locationLabel);
    setZoneId(camera.zoneId);
    setProfileId(camera.profileId);
    setRecordingMode(camera.recordingMode);
    setAssignedPos(camera.assignedPosLabel ?? "");
    setBranchLabel(camera.branchLabel ?? "Main Shop");
    setUsername(camera.credential?.username ?? "admin");
    setPassword("");
    setError(null);
  };

  const showSourceWizard = !loading && cameras.length === 0 && !addMode;
  const scanProgressLabel =
    scanPhase === "agent"
      ? t(lang, "visionScanProgressAgent")
      : scanPhase === "discover"
        ? t(lang, "visionScanProgressDiscover")
        : scanPhase === "collect"
          ? t(lang, "visionScanProgressCollect")
          : null;

  return (
    <BackOfficePageLayout
      header={
        <EnterprisePageHeader
          lang={lang}
          title={t(lang, "visionPageTitle")}
          subtitle={t(lang, "visionPageSub")}
          backFallback="/settings"
          compact
        />
      }
    >
      <div className="space-y-4 pb-10">
        <EnterpriseCard className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <SectionTitle>{t(lang, "visionEdgeStatus")}</SectionTitle>
            <Body className="text-sm text-muted-foreground">
              {agent?.available
                ? t(lang, "visionEdgeOnline").replace("{version}", agent.version ?? "—")
                : t(lang, "visionEdgeOffline")}
            </Body>
            {agent?.message ? <Caption className="text-amber-700 dark:text-amber-400">{agent.message}</Caption> : null}
            <Caption className="mt-1 block font-mono text-xs text-muted-foreground">
              {agent?.baseUrl ?? "http://127.0.0.1:39217"}
            </Caption>
          </div>
          <Caption className="text-muted-foreground">{t(lang, "visionEdgeHint")}</Caption>
        </EnterpriseCard>

        <VisionLicenseStatusStrip lang={lang} access={visionAccess} />

        {visionAccess.status === "subscription_expired" ? (
          <EnterpriseCard className="p-4">
            <Body className="text-sm font-medium">{t(lang, "visionLicSubExpired")}</Body>
            <Caption className="text-muted-foreground">{t(lang, "visionLicSubExpiredHint")}</Caption>
          </EnterpriseCard>
        ) : null}

        {!loading && cameras.length > 0 ? (
          <VisionInstallerDashboard lang={lang} snapshot={installerSnapshot} />
        ) : null}

        {showSourceWizard ? <VisionSourceWizard lang={lang} onChoose={chooseSource} /> : null}

        {!addMode && !showSourceWizard ? (
          <div className="flex flex-wrap gap-2">
            {visionAccess.canMonitor ? (
              <Link
                to="/office/vision/monitor"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-elev"
              >
                <LayoutDashboard className="h-4 w-4" aria-hidden />
                {t(lang, "visionOpenMonitor")}
              </Link>
            ) : null}
            {visionAccess.canLive ? (
              <Link
                to="/office/vision/live"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold hover:bg-muted/40"
              >
                <MonitorPlay className="h-4 w-4" aria-hidden />
                {t(lang, "visionOpenLiveView")}
              </Link>
            ) : null}
            <WakaButton
              type="button"
              onClick={() => {
                setAddMode("nvr");
                setRecordingMode("dvr");
              }}
              className="gap-2"
            >
              <HardDrive className="h-4 w-4" aria-hidden />
              {t(lang, "visionAddDvr")}
            </WakaButton>
            <WakaButton
              type="button"
              variant="secondary"
              onClick={() => {
                setRecordingMode("nvr");
                void openScan();
              }}
              className="gap-2"
            >
              <Radar className="h-4 w-4" aria-hidden />
              {t(lang, "visionScanIpNvr")}
            </WakaButton>
            <WakaButton
              type="button"
              variant="secondary"
              onClick={() => {
                setAddMode("manual");
                applyProfile(profiles[0]?.id ?? "cashier");
              }}
              className="gap-2"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t(lang, "visionAddManual")}
            </WakaButton>
          </div>
        ) : null}

        {addMode === "nvr" ? (
          <EnterpriseCard className="space-y-3 p-4">
            <SectionTitle>{t(lang, "visionDvrTitle")}</SectionTitle>
            <Caption className="text-muted-foreground">{t(lang, "visionSourceDvrBody")}</Caption>
            <Caption className="block text-muted-foreground">{t(lang, "visionSourceAnalogHelper")}</Caption>
            <label className="block text-sm">
              <span className="text-muted-foreground">{t(lang, "visionDvrVendor")}</span>
              <select
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                value={nvrVendor}
                onChange={(e) => setNvrVendor(e.target.value as VisionNvrVendor)}
              >
                {VISION_NVR_VENDORS.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">{t(lang, "visionDvrHost")}</span>
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                value={nvrHost}
                onChange={(e) => setNvrHost(e.target.value)}
                placeholder="192.168.1.50"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-muted-foreground">{t(lang, "visionUsername")}</span>
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t(lang, "visionPassword")}</span>
                <input
                  type="password"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
            </div>
            {error ? <Caption className="text-rose-600">{error}</Caption> : null}
            <div className="flex flex-wrap gap-2">
              <WakaButton type="button" disabled={busy} onClick={() => void runNvrImport()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t(lang, "visionDvrReadChannels")}
              </WakaButton>
              <WakaButton type="button" variant="ghost" onClick={resetWizard}>
                {t(lang, "cancel")}
              </WakaButton>
            </div>
          </EnterpriseCard>
        ) : null}

        {addMode === "manual" ? (
          <EnterpriseCard className="space-y-3 p-4">
            <SectionTitle>{t(lang, "visionManualTitle")}</SectionTitle>
            <AssignmentFields
              lang={lang}
              profiles={profiles}
              profileId={profileId}
              zoneId={zoneId}
              name={name}
              locationLabel={locationLabel}
              recordingMode={recordingMode}
              assignedPos={assignedPos}
              branchLabel={branchLabel}
              onProfile={applyProfile}
              onZone={setZoneId}
              onName={setName}
              onLocation={setLocationLabel}
              onRecording={setRecordingMode}
              onPos={setAssignedPos}
              onBranch={setBranchLabel}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm sm:col-span-2">
                <span className="text-muted-foreground">{t(lang, "visionManualHost")}</span>
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                  value={manualHost}
                  onChange={(e) => setManualHost(e.target.value)}
                  placeholder="192.168.1.64"
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t(lang, "visionManualPort")}</span>
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                  value={manualPort}
                  onChange={(e) => setManualPort(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t(lang, "visionManualPath")}</span>
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                  value={manualPath}
                  onChange={(e) => setManualPath(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t(lang, "visionUsername")}</span>
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t(lang, "visionPassword")}</span>
                <input
                  type="password"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
            </div>
            {error ? <Caption className="text-rose-600">{error}</Caption> : null}
            <div className="flex flex-wrap gap-2">
              <WakaButton type="button" variant="secondary" disabled={busy} onClick={() => void runTestDraft()}>
                {t(lang, "visionTestAction")}
              </WakaButton>
              <WakaButton type="button" disabled={busy} onClick={() => void saveManual()}>
                {t(lang, "visionSaveCamera")}
              </WakaButton>
              <WakaButton type="button" variant="ghost" onClick={resetWizard}>
                {t(lang, "cancel")}
              </WakaButton>
            </div>
            <VisionCameraTestPanel lang={lang} result={testResult} />
          </EnterpriseCard>
        ) : null}

        {addMode === "edit" ? (
          <EnterpriseCard className="space-y-3 p-4">
            <SectionTitle>{t(lang, "visionEditTitle")}</SectionTitle>
            <AssignmentFields
              lang={lang}
              profiles={profiles}
              profileId={profileId}
              zoneId={zoneId}
              name={name}
              locationLabel={locationLabel}
              recordingMode={recordingMode}
              assignedPos={assignedPos}
              branchLabel={branchLabel}
              onProfile={applyProfile}
              onZone={setZoneId}
              onName={setName}
              onLocation={setLocationLabel}
              onRecording={setRecordingMode}
              onPos={setAssignedPos}
              onBranch={setBranchLabel}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-muted-foreground">{t(lang, "visionUsername")}</span>
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t(lang, "visionPassword")}</span>
                <input
                  type="password"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              </label>
            </div>
            {error ? <Caption className="text-rose-600">{error}</Caption> : null}
            <div className="flex flex-wrap gap-2">
              <WakaButton type="button" disabled={busy} onClick={() => void saveEdit()}>
                {t(lang, "visionSaveCamera")}
              </WakaButton>
              <WakaButton type="button" variant="ghost" onClick={resetWizard}>
                {t(lang, "cancel")}
              </WakaButton>
            </div>
          </EnterpriseCard>
        ) : null}

        {addMode === "scan" ? (
          <EnterpriseCard className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>
                {scanning
                  ? t(lang, "visionScanning")
                  : t(lang, "visionFoundCount").replace("{count}", String(candidates.length))}
              </SectionTitle>
              <div className="flex flex-wrap gap-2">
                <WakaButton type="button" variant="secondary" disabled={scanning} onClick={() => void runScan()}>
                  <Network className="h-4 w-4" aria-hidden />
                  {scanning ? t(lang, "visionScanning") : t(lang, "visionScanRetryFailed")}
                </WakaButton>
              </div>
            </div>
            {scanProgressLabel ? (
              <Caption className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {scanProgressLabel}
              </Caption>
            ) : null}
            {scanDemo ? <Caption className="text-amber-700 dark:text-amber-400">{t(lang, "visionDemoScanNote")}</Caption> : null}

            {!scanning && candidates.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                <WakaButton
                  type="button"
                  variant="secondary"
                  onClick={() => setSelectedIds(new Set(candidates.map((c) => c.discoveryId)))}
                >
                  {t(lang, "visionSelectAll")}
                </WakaButton>
                <WakaButton type="button" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                  {t(lang, "visionClearSelection")}
                </WakaButton>
                <WakaButton type="button" disabled={busy || selectedIds.size === 0} onClick={() => void importBulk(false)}>
                  {t(lang, "visionImportSelected")} ({selectedIds.size})
                </WakaButton>
                <WakaButton type="button" disabled={busy} onClick={() => void importBulk(true)}>
                  {t(lang, "visionImportAll")}
                </WakaButton>
              </div>
            ) : null}

            <ul className="grid gap-2 sm:grid-cols-2">
              {candidates.map((c) => {
                const checked = selectedIds.has(c.discoveryId);
                const recorder = looksLikeRecorder(c);
                return (
                  <li key={c.discoveryId}>
                    <div
                      className={`rounded-xl border px-3 py-3 transition ${
                        selected?.discoveryId === c.discoveryId
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={checked}
                          onChange={() => toggleCandidateId(c.discoveryId)}
                          aria-label={c.name || c.ip}
                        />
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => selectCandidate(c)}>
                          <Body className="font-medium">{c.name || c.ip}</Body>
                          <Caption className="text-muted-foreground">
                            {c.ip}
                            {c.brand ? ` · ${c.brand}` : ""}
                            {c.model ? ` · ${c.model}` : ""}
                          </Caption>
                          <Caption className="mt-1 block text-xs text-muted-foreground">
                            {recorder ? t(lang, "visionCandidateNvr") : t(lang, "visionCandidateCamera")}
                          </Caption>
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {selected ? (
              <div className="space-y-3 border-t border-border pt-3">
                <AssignmentFields
                  lang={lang}
                  profiles={profiles}
                  profileId={profileId}
                  zoneId={zoneId}
                  name={name}
                  locationLabel={locationLabel}
                  recordingMode={recordingMode}
                  assignedPos={assignedPos}
                  branchLabel={branchLabel}
                  onProfile={applyProfile}
                  onZone={setZoneId}
                  onName={setName}
                  onLocation={setLocationLabel}
                  onRecording={setRecordingMode}
                  onPos={setAssignedPos}
                  onBranch={setBranchLabel}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="text-muted-foreground">{t(lang, "visionUsername")}</span>
                    <input
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-muted-foreground">{t(lang, "visionPassword")}</span>
                    <input
                      type="password"
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </label>
                </div>
                {error ? <Caption className="text-rose-600">{error}</Caption> : null}
                <div className="flex flex-wrap gap-2">
                  <WakaButton type="button" variant="secondary" disabled={busy} onClick={() => void runTestDraft()}>
                    {t(lang, "visionTestAction")}
                  </WakaButton>
                  <WakaButton type="button" disabled={busy} onClick={() => void saveSelected()}>
                    {t(lang, "visionSaveCamera")}
                  </WakaButton>
                  <WakaButton type="button" variant="ghost" onClick={resetWizard}>
                    {t(lang, "cancel")}
                  </WakaButton>
                </div>
                <VisionCameraTestPanel lang={lang} result={testResult} />
              </div>
            ) : (
              <WakaButton type="button" variant="ghost" onClick={resetWizard}>
                {t(lang, "cancel")}
              </WakaButton>
            )}
          </EnterpriseCard>
        ) : null}

        <section className="space-y-3">
          <SectionTitle>{t(lang, "visionRecordersTitle")}</SectionTitle>
          <Caption className="text-muted-foreground">{t(lang, "visionRecordersSub")}</Caption>
          {loading ? (
            <Caption>{t(lang, "visionLoading")}</Caption>
          ) : cameras.length === 0 && !showSourceWizard ? (
            <EnterpriseCard className="p-4">
              <Body className="font-medium">{t(lang, "visionEmptyTitle")}</Body>
              <Caption className="text-muted-foreground">{t(lang, "visionEmptySub")}</Caption>
            </EnterpriseCard>
          ) : recorders.length > 0 ? (
            <div className="space-y-4">
              <ul className="space-y-3">
                {recorders.map((rec) => (
                  <li key={rec.id}>
                    <VisionRecorderCard
                      lang={lang}
                      recorder={rec}
                      selected={selectedRecorder?.id === rec.id}
                      onSelect={() => setSelectedRecorderId(rec.id)}
                    />
                  </li>
                ))}
              </ul>
              {selectedRecorder ? (
                <div className="space-y-3">
                  <SectionTitle>
                    {t(lang, "visionChannelsTitle")} — {selectedRecorder.name}
                  </SectionTitle>
                  <Caption className="text-muted-foreground">{t(lang, "visionChannelsSub")}</Caption>
                  <ul className="space-y-3">
                    {visibleRegistryCameras.map((cam) => (
                      <li key={cam.id}>
                        <VisionCameraRegistryCard
                          lang={lang}
                          camera={cam}
                          lastTest={testByCamera[cam.id] ?? (activeId === cam.id ? testResult : null)}
                          busy={busy}
                          showTest={activeId === cam.id}
                          onTest={() => void runTestSaved(cam)}
                          onEdit={() => openEdit(cam)}
                          onDelete={() => void removeCamera(cam)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="space-y-2">
          <SectionTitle>{t(lang, "visionSettingsSection")}</SectionTitle>
          <VisionHardwareRecommendations lang={lang} />
        </section>
      </div>
    </BackOfficePageLayout>
  );
}

function AssignmentFields({
  lang,
  profiles,
  profileId,
  zoneId,
  name,
  locationLabel,
  recordingMode,
  assignedPos,
  branchLabel,
  onProfile,
  onZone,
  onName,
  onLocation,
  onRecording,
  onPos,
  onBranch,
}: {
  lang: Language;
  profiles: ReturnType<typeof suggestVisionCameraProfiles>;
  profileId: VisionCameraProfileId;
  zoneId: VisionZoneId;
  name: string;
  locationLabel: string;
  recordingMode: VisionRecordingMode;
  assignedPos: string;
  branchLabel: string;
  onProfile: (id: VisionCameraProfileId) => void;
  onZone: (id: VisionZoneId) => void;
  onName: (v: string) => void;
  onLocation: (v: string) => void;
  onRecording: (v: VisionRecordingMode) => void;
  onPos: (v: string) => void;
  onBranch: (v: string) => void;
}) {
  return (
    <>
      <label className="block text-sm">
        <span className="text-muted-foreground">{t(lang, "visionProfileLabel")}</span>
        <select
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
          value={profileId}
          onChange={(e) => onProfile(e.target.value as VisionCameraProfileId)}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {t(lang, p.nameKey)}
            </option>
          ))}
          <option value="custom">{t(lang, "visionProfileCustom")}</option>
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted-foreground">{t(lang, "visionFieldName")}</span>
          <input
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder={t(lang, "visionProfileCashier")}
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground">{t(lang, "visionFieldLocation")}</span>
          <input
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
            value={locationLabel}
            onChange={(e) => onLocation(e.target.value)}
            placeholder={t(lang, "visionProfileCashierHint")}
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="text-muted-foreground">{t(lang, "visionFieldZone")}</span>
        <select
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
          value={zoneId}
          onChange={(e) => onZone(e.target.value as VisionZoneId)}
        >
          {VISION_ZONE_OPTIONS.map((z) => (
            <option key={z.id} value={z.id}>
              {t(lang, z.labelKey)}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted-foreground">{t(lang, "visionFieldRecording")}</span>
          <select
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
            value={recordingMode}
            onChange={(e) => onRecording(e.target.value as VisionRecordingMode)}
          >
            <option value="dvr">DVR (analog / HD)</option>
            <option value="nvr">NVR (IP)</option>
            <option value="camera_sd">Camera SD</option>
            <option value="cloud">Cloud</option>
            <option value="hybrid">Hybrid</option>
            <option value="none">None</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground">{t(lang, "visionFieldPos")}</span>
          <input
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
            value={assignedPos}
            onChange={(e) => onPos(e.target.value)}
            placeholder="POS #2"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-muted-foreground">{t(lang, "visionFieldBranchInput")}</span>
          <input
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
            value={branchLabel}
            onChange={(e) => onBranch(e.target.value)}
            placeholder="Main Shop"
          />
        </label>
      </div>
    </>
  );
}
