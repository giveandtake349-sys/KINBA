import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import {
  SettingsButton,
  SettingsField,
  SettingsFormMessage,
  SettingsGroup,
  SettingsNote,
  SettingsRow,
} from "./atoms";

const MIN_PASSWORD_LENGTH = 8;

function clearStoredAuth() {
  if (typeof window === "undefined") return;
  Object.keys(window.localStorage)
    .filter(key => key.startsWith("sb-") || key.startsWith("kinba-auth"))
    .forEach(key => window.localStorage.removeItem(key));
}

export default function SecurityPane() {
  const auth = useAuth();
  const [, navigate] = useLocation();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [signingOutOthers, setSigningOutOthers] = useState(false);

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingPassword) return;
    setPasswordMessage(null);
    setPasswordError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(
        `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`
      );
      return;
    }
    if (password !== confirm) {
      setPasswordError("The two passwords don't match.");
      return;
    }

    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword("");
      setConfirm("");
      setPasswordMessage({
        tone: "success",
        text: "Password updated. Use it the next time you sign in.",
      });
    } catch (error) {
      setPasswordMessage({
        tone: "error",
        text:
          error instanceof Error && error.message
            ? error.message
            : "We couldn't update your password.",
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const logOutOtherDevices = async () => {
    if (signingOutOthers) return;
    const confirmed = window.confirm(
      "Sign out of every other device? This device stays signed in."
    );
    if (!confirmed) return;
    setSigningOutOthers(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
      toast.success("Other devices have been signed out.");
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "We couldn't sign out your other devices."
      );
    } finally {
      setSigningOutOthers(false);
    }
  };

  const logOutEverywhere = async () => {
    const confirmed = window.confirm(
      "Sign out of JHILIK on this device and everywhere else?"
    );
    if (!confirmed) return;
    try {
      await auth.logout();
      clearStoredAuth();
      navigate("/login");
    } catch (error) {
      toast.error(
        error instanceof Error && error.message ? error.message : "Unable to log out."
      );
    }
  };

  return (
    <>
      <div className="settings-pane__header">
        <p className="settings-pane__eyebrow">Security</p>
        <h2 className="settings-pane__title">Protect your account</h2>
        <p className="settings-pane__subtitle">
          Password, signed-in devices, and the safeguards JHILIK can run for
          you today.
        </p>
      </div>

      <SettingsGroup
        title="Password"
        hint="Changing your password keeps you signed in on this device."
      >
        <li className="settings-row settings-row--form">
          <form className="settings-password-form" onSubmit={submitPassword}>
            <SettingsField
              label="New password"
              htmlFor="settings-new-password"
              error={passwordError}
              hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            >
              <input
                id="settings-new-password"
                className="settings-input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                disabled={savingPassword}
                minLength={MIN_PASSWORD_LENGTH}
              />
            </SettingsField>
            <SettingsField
              label="Confirm new password"
              htmlFor="settings-confirm-password"
            >
              <input
                id="settings-confirm-password"
                className="settings-input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={event => setConfirm(event.target.value)}
                disabled={savingPassword}
                minLength={MIN_PASSWORD_LENGTH}
              />
            </SettingsField>
            <div className="settings-pane__actions">
              <SettingsButton type="submit" busy={savingPassword}>
                {savingPassword ? "Saving…" : "Update password"}
              </SettingsButton>
            </div>
            <SettingsFormMessage tone={passwordMessage?.tone ?? "success"}>
              {passwordMessage?.text ?? ""}
            </SettingsFormMessage>
          </form>
        </li>
      </SettingsGroup>

      <SettingsGroup
        title="Sessions"
        hint="JHILIK signs you in through Supabase, so sessions are managed there."
      >
        <SettingsRow
          kind="action"
          label="Sign out other devices"
          description="Ends every session except the one you are using now"
          onClick={() => void logOutOtherDevices()}
          disabled={signingOutOthers}
        />
        <SettingsRow
          kind="action"
          danger
          label="Sign out everywhere"
          description="Ends this session and all others, on every device"
          onClick={() => void logOutEverywhere()}
        />
        <SettingsRow
          kind="unavailable"
          label="Active sessions & devices"
          description="See a list of devices currently signed in"
          note="Supabase doesn't expose a session list to the browser, so we can't show devices here yet."
        />
      </SettingsGroup>

      <SettingsGroup title="Protection">
        <SettingsRow
          kind="unavailable"
          label="Two-factor authentication"
          description="Require a second step when you sign in"
          note="Two-factor auth has to be enabled in the Supabase project first — turning it on here would be a fake switch."
        />
        <SettingsRow
          kind="unavailable"
          label="Login & security alerts"
          description="Get notified when a new device signs in"
          note="JHILIK has no sign-in event feed to notify you from yet."
        />
        <SettingsRow
          kind="unavailable"
          label="Blocked accounts"
          description="Review and unblock people you have blocked"
          note="The blocks table exists, but no API reads it yet — so there is nothing honest to list."
        />
      </SettingsGroup>

      <SettingsNote tone="warning">
        Passwords and sessions are handled directly by Supabase Auth. JHILIK
        never sees or stores your password.
      </SettingsNote>
    </>
  );
}
