import { FormEvent, useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { GoogleIcon } from "@/components/GoogleIcon";
import { startGoogleSignIn, oauthErrorMessage } from "@/lib/oauth";
import "./authModal.css";

type SupabaseAuthDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SupabaseAuthDialog({
  open,
  onOpenChange,
}: SupabaseAuthDialogProps) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (!open) return null;

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    try {
      const result =
        mode === "sign-in"
          ? await supabase.auth.signInWithPassword({
              email: email.trim(),
              password,
            })
          : await supabase.auth.signUp({ email: email.trim(), password });
      if (result.error) throw result.error;
      if (mode === "sign-up" && !result.data.session) {
        toast.success(
          "Account created. Check your email to confirm your address, then sign in."
        );
      } else {
        toast.success(
          mode === "sign-in"
            ? "Welcome to JHILIK."
            : "Your JHILIK account is ready."
        );
      }
      setPassword("");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to authenticate."
      );
    } finally {
      setPending(false);
    }
  };

  const continueWithGoogle = async () => {
    setGooglePending(true);
    try {
      await startGoogleSignIn(
        `${window.location.pathname}${window.location.search}`
      );
    } catch (error) {
      toast.error(oauthErrorMessage(error, "Unable to start Google sign-in."));
      setGooglePending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="request-modal auth-modal"
        onSubmit={submitAuth}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
      >
        <button
          type="button"
          className="modal-close"
          onClick={() => onOpenChange(false)}
          aria-label="Close authentication dialog"
        >
          <X size={18} />
        </button>
        <div className="auth-head">
          <span className="auth-brand-wordmark">JHILIK</span>
          <h2 id="auth-title">
            {mode === "sign-in" ? "Welcome back." : "Join the network."}
          </h2>
          <p className="modal-copy">
            {mode === "sign-in"
              ? "Sign in to pick up where you left off."
              : "Create your account to keep your profile and content."}
          </p>
        </div>
        <button
          type="button"
          className="oauth-btn"
          onClick={continueWithGoogle}
          disabled={pending || googlePending}
        >
          {googlePending ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <GoogleIcon size={16} />
          )}
          Continue with Google
        </button>
        <div className="auth-divider">
          <span>or use email</span>
        </div>
        <div className="auth-tabs" role="tablist" aria-label="Account mode">
          {(["sign-in", "sign-up"] as const).map(value => (
            <button
              key={value}
              type="button"
              role="tab"
              className="auth-tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
            >
              {value === "sign-in" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>
        <label className="input-label">
          <span>Email</span>
          <div className="auth-field">
            <Mail size={16} aria-hidden="true" />
            <input
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </div>
        </label>
        <label className="input-label">
          <span>Password</span>
          <div className="auth-field">
            <Lock size={16} aria-hidden="true" />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete={
                mode === "sign-in" ? "current-password" : "new-password"
              }
              placeholder="At least 6 characters"
              minLength={6}
              required
            />
            <button
              type="button"
              className="auth-eye"
              onClick={() => setShowPassword(value => !value)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>
        <button
          className="primary-btn primary-btn--wide"
          type="submit"
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="spin" size={16} />
          ) : mode === "sign-in" ? (
            "Sign in"
          ) : (
            "Create account"
          )}
          <ArrowRight size={16} />
        </button>
        <button
          type="button"
          className="auth-mode-toggle"
          onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
        >
          {mode === "sign-in" ? (
            <>
              Need an account? <strong>Create one</strong>
            </>
          ) : (
            <>
              Already have an account? <strong>Sign in</strong>
            </>
          )}
        </button>
      </form>
    </div>
  );
}
