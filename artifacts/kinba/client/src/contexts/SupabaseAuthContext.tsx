import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";

type SupabaseAuthContextValue = {
  session: Session | null;
  loading: boolean;
  bootstrapError: Error | null;
  authDialogOpen: boolean;
  openAuth: () => void;
  closeAuth: () => void;
};

const SupabaseAuthContext = createContext<SupabaseAuthContextValue | null>(null);

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<Error | null>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const openAuth = useCallback(() => setAuthDialogOpen(true), []);
  const closeAuth = useCallback(() => setAuthDialogOpen(false), []);

  useEffect(() => {
    let mounted = true;
    const timeoutId = window.setTimeout(() => {
      if (!mounted) return;
      setBootstrapError(new Error("KINBA could not reach the authentication service within 10 seconds."));
      setLoading(false);
    }, 10_000);
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        window.clearTimeout(timeoutId);
        if (error) console.warn("[Supabase Auth] Session restore failed:", error);
        setSession(data.session);
        setBootstrapError(error ?? null);
        setLoading(false);
      })
      .catch(error => {
        if (!mounted) return;
        window.clearTimeout(timeoutId);
        console.warn("[Supabase Auth] Session restore failed:", error);
        setSession(null);
        setBootstrapError(error instanceof Error ? error : new Error("Authentication service is unavailable."));
        setLoading(false);
      });

    const { data: authSubscription } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!mounted) return;
        setSession(nextSession);
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      window.clearTimeout(timeoutId);
      authSubscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ session, loading, bootstrapError, authDialogOpen, openAuth, closeAuth }), [authDialogOpen, bootstrapError, closeAuth, loading, openAuth, session]);

  return <SupabaseAuthContext.Provider value={value}>{children}</SupabaseAuthContext.Provider>;
}

export function useSupabaseAuth() {
  const context = useContext(SupabaseAuthContext);
  if (!context) throw new Error("useSupabaseAuth must be used inside SupabaseAuthProvider");
  return context;
}
