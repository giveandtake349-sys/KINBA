import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { oauthErrorMessage, startGoogleLink } from "@/lib/oauth";
import { supabase } from "@/lib/supabase";

type UseGoogleIdentityResult = {
  linked: boolean;
  pending: boolean;
  connect: () => Promise<void>;
};

function hasGoogleIdentity(
  identities: { provider?: string }[] | undefined | null
): boolean | undefined {
  if (!identities) return undefined;
  return identities.some(identity => identity.provider === "google");
}

/**
 * Tracks whether the signed-in Supabase user already has a linked Google
 * identity, and starts the link flow for email/password users.
 */
export function useGoogleIdentity(): UseGoogleIdentityResult {
  const { session, loading, openAuth } = useSupabaseAuth();
  const [linked, setLinked] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (loading || !session?.user) {
      setLinked(false);
      return;
    }
    const user = session.user;
    const fromSession = hasGoogleIdentity(user.identities);
    if (fromSession === true) {
      setLinked(true);
      return;
    }
    // The token response can omit or stale `identities` (fresh link round trip),
    // so confirm against the server instead of trusting a false negative.
    let mounted = true;
    void supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!mounted) return;
        setLinked(hasGoogleIdentity(data.user?.identities) === true);
      })
      .catch(() => {
        // Keep the optimistic value derived from the cached session.
        if (mounted && fromSession !== undefined) setLinked(false);
      });

    return () => {
      mounted = false;
    };
  }, [loading, session]);

  const connect = useCallback(async () => {
    if (!session) {
      openAuth();
      return;
    }
    setPending(true);
    try {
      await startGoogleLink();
    } catch (error) {
      toast.error(oauthErrorMessage(error, "Unable to connect Google."));
      setPending(false);
    }
  }, [openAuth, session]);

  return { linked, pending, connect };
}
