import { useEffect, useState } from "react";
import {
  DEFAULT_PLATFORM_BUSINESS_TYPE_SETTINGS,
  type PlatformBusinessTypeSettings,
} from "../config/businessTypeVisibility";
import { fetchPlatformBusinessTypeSettings, isCurrentUserSuperAdmin } from "../lib/platformBusinessTypes";

export function useBusinessTypeVisibility() {
  const [settings, setSettings] = useState<PlatformBusinessTypeSettings>(
    DEFAULT_PLATFORM_BUSINESS_TYPE_SETTINGS,
  );
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [s, superRow] = await Promise.all([
        fetchPlatformBusinessTypeSettings(),
        isCurrentUserSuperAdmin(),
      ]);
      if (cancelled) return;
      setSettings(s);
      setIsSuperAdmin(superRow);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { settings, isSuperAdmin, loading };
}
