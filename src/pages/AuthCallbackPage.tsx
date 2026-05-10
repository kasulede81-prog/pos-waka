import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/** Email confirmation redirect target (add this URL to Supabase Auth redirect URLs). */
export function AuthCallbackPage() {
  const tries = useRef(0);
  const [destination, setDestination] = useState<"dash" | "login" | "wait">("wait");

  useEffect(() => {
    const sb = supabase;
    if (!sb) {
      setDestination("login");
      return undefined;
    }

    const timer = window.setInterval(() => {
      tries.current += 1;
      sb.auth.getSession().then(({ data }) => {
        if (data.session) {
          window.clearInterval(timer);
          setDestination("dash");
        } else if (tries.current > 35) {
          window.clearInterval(timer);
          setDestination("login");
        }
      });
    }, 140);

    return () => window.clearInterval(timer);
  }, []);

  if (destination === "dash") return <Navigate to="/" replace />;
  if (destination === "login") return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-50 px-4 text-center text-sm text-slate-600">
      <p>Synchronising session…</p>
      <p className="text-xs text-slate-400">If this hangs, reopen the app — your email link may already be validated.</p>
    </div>
  );
}
