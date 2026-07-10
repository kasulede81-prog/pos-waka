import { useCallback, useEffect, useState } from "react";
import {
  PREVIEW_ACTIVATIONS,
  PREVIEW_FLEET_DEVICES,
  PREVIEW_INTERNAL_ADMINS,
  PREVIEW_RECENT_SHOPS,
  PREVIEW_SUPPORT_TICKETS,
} from "../lib/internalAdminPreview";
import { PREVIEW_APP_RELEASES } from "../lib/releaseManagementAdmin";
import { opsListActivationRequests, type OpsActivationRow } from "../lib/businessActivation";
import { fetchFleetDevices, fetchInternalAdmins, fetchShopsBySignupDate, fetchSupportTickets } from "../lib/wakaInternalAdmin";
import { fetchAppReleases } from "../lib/releaseManagementAdmin";
import { internalListMarketingAgents } from "../lib/referralAgents";
import { fetchPricingCampaigns, type PricingCampaign } from "../lib/pricingCampaignsAdmin";
import { fetchGrowthCampaigns } from "../lib/growthCampaignsAdmin";
import type { GrowthCampaign } from "../lib/growthCampaigns";
import { AI_PROVIDER_OPTIONS } from "../lib/ai/platformAiSettings.v2";
import type { AppReleaseSummary } from "../lib/releaseManagementAdmin";
import type {
  FleetDeviceRow,
  InternalAdminRow,
  RecentShopRow,
  SupportTicketRow,
} from "../lib/wakaInternalAdmin";

export type MarketingAgentSearchRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone_e164: string | null;
};

export type AiProviderSearchRow = {
  id: string;
  label: string;
};

export type FeatureFlagSearchRow = {
  id: string;
  label: string;
  path: string;
};

/** Static internal-admin feature toggles surfaced in global search. */
export const INTERNAL_ADMIN_FEATURE_FLAGS: FeatureFlagSearchRow[] = [
  { id: "pilot", label: "Pilot cohort", path: "/internal/waka/pilot" },
  { id: "display_scale", label: "POS display scale", path: "/internal/waka/display-scale" },
  { id: "business_types", label: "Business types", path: "/internal/waka/business-types" },
];

export type AdminGlobalSearchData = {
  loading: boolean;
  shops: RecentShopRow[];
  tickets: SupportTicketRow[];
  devices: FleetDeviceRow[];
  admins: InternalAdminRow[];
  agents: MarketingAgentSearchRow[];
  releases: AppReleaseSummary[];
  activations: OpsActivationRow[];
  pricingCampaigns: PricingCampaign[];
  growthCampaigns: GrowthCampaign[];
  aiProviders: AiProviderSearchRow[];
  featureFlags: FeatureFlagSearchRow[];
  refresh: () => void;
};

export function useAdminGlobalSearchData(previewMode: boolean): AdminGlobalSearchData {
  const [loading, setLoading] = useState(true);
  const [shops, setShops] = useState<RecentShopRow[]>([]);
  const [tickets, setTickets] = useState<SupportTicketRow[]>([]);
  const [devices, setDevices] = useState<FleetDeviceRow[]>([]);
  const [admins, setAdmins] = useState<InternalAdminRow[]>([]);
  const [agents, setAgents] = useState<MarketingAgentSearchRow[]>([]);
  const [releases, setReleases] = useState<AppReleaseSummary[]>([]);
  const [activations, setActivations] = useState<OpsActivationRow[]>([]);
  const [pricingCampaigns, setPricingCampaigns] = useState<PricingCampaign[]>([]);
  const [growthCampaigns, setGrowthCampaigns] = useState<GrowthCampaign[]>([]);

  const aiProviders: AiProviderSearchRow[] = AI_PROVIDER_OPTIONS.map((p) => ({
    id: p,
    label: p.charAt(0).toUpperCase() + p.slice(1),
  }));

  const load = useCallback(async () => {
    setLoading(true);
    if (previewMode) {
      setShops(PREVIEW_RECENT_SHOPS);
      setTickets(PREVIEW_SUPPORT_TICKETS);
      setDevices(PREVIEW_FLEET_DEVICES);
      setAdmins(PREVIEW_INTERNAL_ADMINS);
      setAgents([
        { id: "preview-agent-1", full_name: "Preview Agent", email: "agent@waka.ug", phone_e164: "+256700000099" },
      ]);
      setReleases(PREVIEW_APP_RELEASES);
      setActivations(PREVIEW_ACTIVATIONS);
      setPricingCampaigns([
        {
          id: "preview-pricing-1",
          name: "Preview Launch Offer",
          description: "Sample pricing campaign",
          enabled: true,
          startsAt: new Date().toISOString(),
          endsAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      setGrowthCampaigns([
        {
          id: "preview-growth-1",
          name: "Preview Growth Wave",
          description: "Sample growth campaign",
          enabled: true,
          grantMode: "automatic",
          grantedPlanCode: "business",
          durationDays: 14,
          startsAt: new Date().toISOString(),
          endsAt: null,
        },
      ]);
      setLoading(false);
      return;
    }
    const [
      shopRows,
      ticketRows,
      deviceRows,
      adminRows,
      agentResult,
      releaseRows,
      activationRows,
      pricingRows,
      growthRows,
    ] = await Promise.all([
      fetchShopsBySignupDate(100),
      fetchSupportTickets(80),
      fetchFleetDevices(120),
      fetchInternalAdmins(),
      internalListMarketingAgents(),
      fetchAppReleases(),
      opsListActivationRequests(),
      fetchPricingCampaigns(),
      fetchGrowthCampaigns(),
    ]);
    setShops(shopRows);
    setTickets(ticketRows);
    setDevices(deviceRows);
    setAdmins(adminRows);
    setAgents(
      agentResult.rows.map((a) => ({
        id: a.id,
        full_name: a.fullName,
        email: a.email,
        phone_e164: a.phoneE164,
      })),
    );
    setReleases(releaseRows);
    setActivations(activationRows);
    setPricingCampaigns(pricingRows);
    setGrowthCampaigns(growthRows);
    setLoading(false);
  }, [previewMode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (previewMode) return;
    const onRefresh = () => void load();
    window.addEventListener("waka:internal-ops-changed", onRefresh);
    return () => window.removeEventListener("waka:internal-ops-changed", onRefresh);
  }, [load, previewMode]);

  return {
    loading,
    shops,
    tickets,
    devices,
    admins,
    agents,
    releases,
    activations,
    pricingCampaigns,
    growthCampaigns,
    aiProviders,
    featureFlags: INTERNAL_ADMIN_FEATURE_FLAGS,
    refresh: () => void load(),
  };
}
