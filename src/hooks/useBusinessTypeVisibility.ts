import { useEffect, useState } from "react";
import {
  DEFAULT_PLATFORM_BUSINESS_TYPE_SETTINGS,
  REGISTRATION_SAFE_BUSINESS_TYPE_SETTINGS,
  type PlatformBusinessTypeSettings,
} from "../config/businessTypeVisibility";
import { fetchPlatformBusinessTypeSettings, isCurrentUserSuperAdmin } from "../lib/platformBusinessTypes";

type Options = {
  /** Registration/onboarding: always apply enabled list (no super-admin “see all types”). */
  forRegistration?: boolean;
};

export function useBusinessTypeVisibility(opts?: Options) {
  const forRegistration = opts?.forRegistration ?? false;
  const [settings, setSettings] = useState<PlatformBusinessTypeSettings>(
    forRegistration ? REGISTRATION_SAFE_BUSINESS_TYPE_SETTINGS : DEFAULT_PLATFORM_BUSINESS_TYPE_SETTINGS,
  );
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fromServer, setFromServer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [fetched, superRow] = await Promise.all([
        fetchPlatformBusinessTypeSettings(false, { forRegistration }),
        forRegistration ? Promise.resolve(false) : isCurrentUserSuperAdmin(),
      ]);
      if (cancelled) return;
      setSettings(fetched.settings);
      setFromServer(fetched.fromServer);
      setIsSuperAdmin(forRegistration ? false : superRow);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [forRegistration]);

  return { settings, isSuperAdmin, loading, fromServer };
}
