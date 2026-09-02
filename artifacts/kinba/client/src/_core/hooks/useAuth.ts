import {
  SupabaseAuthProvider,
  useSupabaseAuth,
} from "@/contexts/SupabaseAuthContext";
import { trpc } from "@/lib/trpc";
import { supabase } from "@/lib/supabase";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const authContext = useSupabaseAuth();
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: !authContext.loading,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    utils.auth.me.setData(undefined, null);
    await utils.auth.me.invalidate();
  }, [utils]);

  const state = useMemo(
    () => ({
      user: meQuery.data ?? null,
      loading: authContext.loading || meQuery.isLoading,
      error: meQuery.error ?? null,
      isAuthenticated: Boolean(authContext.session),
    }),
    [
      authContext.loading,
      authContext.session,
      meQuery.data,
      meQuery.error,
      meQuery.isLoading,
    ]
  );

  useEffect(() => {
    if (!redirectOnUnauthenticated || state.loading || state.user) return;
    if (redirectPath && window.location.pathname === redirectPath) return;
    authContext.openAuth();
  }, [
    authContext,
    redirectOnUnauthenticated,
    redirectPath,
    state.loading,
    state.user,
  ]);

  return {
    ...state,
    session: authContext.session,
    authDialogOpen: authContext.authDialogOpen,
    openAuth: authContext.openAuth,
    closeAuth: authContext.closeAuth,
    refresh: () => meQuery.refetch(),
    logout,
    unauthenticatedError:
      meQuery.error instanceof TRPCClientError &&
      meQuery.error.data?.code === "UNAUTHORIZED",
  };
}

export { SupabaseAuthProvider };
