import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import {
  describeOAuthError,
  peekOAuthIntent,
  takeOAuthIntent,
  takeOAuthReturnPath,
} from "@/lib/oauth";

type CallbackStatus = "working" | "failed";

/**
 * Landing route for the Supabase Google OAuth round trip. The supabase client
 * already exchanges the `?code=` for a session (`detectSessionInUrl`), and it
 * removes `code` from the URL once the exchange succeeds, so this page decides
 * the outcome from the pending intent this tab stored before redirecting.
 */
export default function AuthCallback() {
  const { loading, session } = useSupabaseAuth();
  const [, navigate] = useLocation();
  const settled = useRef(false);
  const [status, setStatus] = useState<CallbackStatus>("working");

  useEffect(() => {
    if (settled.current) return;
    const goBack = () => navigate(takeOAuthReturnPath(), { replace: true });
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get("error_code") ?? params.get("error");
    const intent = peekOAuthIntent();

    if (errorCode) {
      settled.current = true;
      setStatus("failed");
      takeOAuthIntent();
      toast.error(
        describeOAuthError(errorCode, params.get("error_description"))
      );
      goBack();
      return;
    }

    if (loading) return;
    settled.current = true;

    if (intent === null) {
      goBack();
      return;
    }

    if (session) {
      toast.success(
        takeOAuthIntent() === "link"
          ? "Google account connected."
          : "Signed in with Google."
      );
      goBack();
      return;
    }

    takeOAuthIntent();
    setStatus("failed");
    toast.error("Google sign-in could not be completed. Please try again.");
    goBack();
  }, [loading, navigate, session]);

  return (
    <div className="oauth-callback" role="status" aria-live="polite">
      <Loader2 className="spin" size={26} />
      <p>
        {status === "failed"
          ? "Returning you to JHILIK…"
          : "Finishing Google sign-in…"}
      </p>
    </div>
  );
}
