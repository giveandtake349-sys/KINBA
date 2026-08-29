import { FormEvent, useState } from "react";
import { ArrowRight, Loader2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

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

  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
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
            ? "Welcome to Kinba."
            : "Your Kinba account is ready."
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

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="request-modal auth-modal"
        onSubmit={submit}
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
        <img src="/logo.png" alt="Kinba" className="auth-brand-logo" />
        <p className="eyebrow">Kinba account</p>
        <h2 id="auth-title">
          {mode === "sign-in" ? "Welcome back." : "Join the network."}
        </h2>
        <p className="modal-copy">
          Use your email and password to keep your profile and content
          persistent.
        </p>
        <label className="input-label">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label className="input-label">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            autoComplete={
              mode === "sign-in" ? "current-password" : "new-password"
            }
            minLength={6}
            required
          />
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
          {mode === "sign-in"
            ? "Need an account? Create one"
            : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
