import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { fetchWakaInternalAdminMe } from "../lib/wakaInternalAdmin";
import { fetchMyActivationGate, isPosUnlocked, type ActivationGatePayload } from "../lib/businessActivation";

type ActivationContextValue = {
  loading: boolean;
  gate: ActivationGatePayload | null;
  bypass: boolean;
  unlocked: boolean;
  refresh: () => Promise<void>;
};

const Ctx = createContext<ActivationContextValue>({
  loading: false,
  gate: null,
  bypass: true,
  unlocked: true,
  refresh: async () => {},
});

const ACTIVATION_CACHE_KEY = "waka.activation.gate.v1";

function readActivationCache(userId: string): ActivationGatePayload | null {
  try {
    const raw = sessionStorage.getItem(`${ACTIVATION_CACHE_KEY}:${userId}`);
    if (!raw) return null;
    return JSON.parse(raw) as ActivationGatePayload;
  } catch {
    return null;
  }
}

function writeActivationCache(userId: string, gate: ActivationGatePayload | null): void {
  try {
    const k = `${ACTIVATION_CACHE_KEY}:${userId}`;
    if (!gate) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, JSON.stringify(gate));
  } catch {
    /* ignore */
  }
}

const ACTIVATION_GATE_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return new Promise((resolve) => {
    const t = window.setTimeout(() => resolve(onTimeout), ms);
    void promise.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      () => {
        window.clearTimeout(t);
        resolve(onTimeout);
      },
    );
  });
}

const LOCKED_ALLOWED_EXACT = new Set([
  "/activate",
  "/demo",
  "/support",
  "/auth/callback",
  "/auth/recovery",
  "/verify-email",
  "/login",
  "/register",
  "/onboarding",
  "/forgot-password",
  "/home",
  "/settings",
  "/upgrade",
]);

const LOCKED_ALLOWED_PREFIX = ["/demo/", "/settings/"];

export function pathAllowedWhenActivationLocked(pathname: string): boolean {
  const p = pathname.split("?")[0] || "/";
  if (LOCKED_ALLOWED_EXACT.has(p)) return true;
  if (LOCKED_ALLOWED_PREFIX.some((x) => p === x.slice(0, -1) || p.startsWith(x))) return true;
  return false;
}

export function ActivationProvider({
  authMode,
  user,
  children,
}: {
  authMode: "supabase" | "local";
  user: User | null;
  children: ReactNode;
}) {
  const cachedGate = user?.id && authMode === "supabase" ? readActivationCache(user.id) : null;
  const [loading, setLoading] = useState(
    () => authMode === "supabase" && Boolean(user?.id) && !cachedGate,
  );
  const [gate, setGate] = useState<ActivationGatePayload | null>(cachedGate);
  const [internalBypass, setInternalBypass] = useState(false);
  const gateRef = useRef(gate);
  gateRef.current = gate;

  const load = useCallback(async () => {
    if (authMode !== "supabase" || !user?.id) {
      setGate(null);
      setInternalBypass(false);
      setLoading(false);
      return;
    }
    if (!gateRef.current) setLoading(true);
    try {
      const g = await withTimeout(fetchMyActivationGate(), ACTIVATION_GATE_TIMEOUT_MS, gateRef.current);
      setGate(g);
      writeActivationCache(user.id, g);
      void withTimeout(fetchWakaInternalAdminMe(), ACTIVATION_GATE_TIMEOUT_MS, null).then((adm) => {
        if (adm?.active) setInternalBypass(true);
      });
    } catch {
      if (!gateRef.current) setGate(null);
      setInternalBypass(false);
    } finally {
      setLoading(false);
    }
  }, [authMode, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const fn = () => void load();
    window.addEventListener("waka:activation-updated", fn);
    return () => window.removeEventListener("waka:activation-updated", fn);
  }, [load]);

  const bypass = authMode === "local" || internalBypass;
  const unlocked = bypass || isPosUnlocked(gate);

  const value = useMemo(
    () => ({
      loading,
      gate,
      bypass,
      unlocked,
      refresh: load,
    }),
    [loading, gate, bypass, unlocked, load],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActivation(): ActivationContextValue {
  return useContext(Ctx);
}
