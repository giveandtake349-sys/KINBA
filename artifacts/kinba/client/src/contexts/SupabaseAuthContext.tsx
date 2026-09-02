import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";

type SupabaseAuthContextValue = {
  session: Session | null;
  loading: boolean;
  authDialogOpen: boolean;
  openAuth: () => void;
  closeAuth: () => void;
};

const SupabaseAuthContext = createContext<SupabaseAuthContextValue | null>(null);

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const openAuth = useCallback(() => setAuthDialogOpen(true), []);
  const closeAuth = useCallback(() => setAuthDialogOpen(false), []);

  useEffect(() => {
    let mounted = true;
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) console.warn("[Supabase Auth] Session restore failed:", error);
        setSession(data.session);
        setLoading(false);
      })
      .catch(error => {
        if (!mounted) return;
        console.warn("[Supabase Auth] Session restore failed:", error);
        setSession(null);
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
      authSubscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ session, loading, authDialogOpen, openAuth, closeAuth }), [authDialogOpen, closeAuth, loading, openAuth, session]);

  return <SupabaseAuthContext.Provider value={value}>{children}</SupabaseAuthContext.Provider>;
}

export function useSupabaseAuth() {
  const context = useContext(SupabaseAuthContext);
  if (!context) throw new Error("useSupabaseAuth must be used inside SupabaseAuthProvider");
  return context;
}
