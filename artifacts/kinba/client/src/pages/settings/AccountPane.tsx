import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useGoogleIdentity } from "@/hooks/useGoogleIdentity";
import { ProfileEditModal } from "@/components/ProfileView";
import { GoogleIcon } from "@/components/GoogleIcon";
import {
  SettingsButton,
  SettingsGroup,
  SettingsNote,
  SettingsRow,
  SettingsState,
} from "./atoms";
import {
  accountTypeLabel,
  formatMemberSince,
  roleLabel,
  verificationLabel,
} from "./model";

const LOGIN_METHOD_LABELS: Record<string, string> = {
  supabase: "Email or Google",
  google: "Google",
};

export default function AccountPane() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [editOpen, setEditOpen] = useState(false);
  const google = useGoogleIdentity();

  const profileQuery = trpc.profile.me.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const verificationQuery = trpc.profile.verification.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  if (profileQuery.isPending) {
    return (
      <SettingsState kind="loading" message="Loading your account…" />
    );
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <SettingsState
        kind="error"
        message="We couldn't load your account details."
        onRetry={() => void profileQuery.refetch()}
      />
    );
  }

  const snapshot = profileQuery.data;
  const user = snapshot.user;
  const profile = snapshot.profile;
  const email = user?.email?.trim() || null;
  const username = profile?.username?.trim() || null;
  const loginMethod = LOGIN_METHOD_LABELS[user?.loginMethod ?? ""] ?? "Email";

  return (
    <>
      <div className="settings-pane__header">
        <p className="settings-pane__eyebrow">Account</p>
        <h2 className="settings-pane__title">Your JHILIK identity</h2>
        <p className="settings-pane__subtitle">
          Personal details, how you sign in, and the type of account you hold.
        </p>
      </div>

      <SettingsGroup title="Profile">
        <SettingsRow
          kind="action"
          label="Personal information"
          description="Username, bio and profile photo"
          value={username ? `@${username}` : "Add a username"}
          onClick={() => setEditOpen(true)}
          data-testid="account-personal-information"
        />
        <SettingsRow
          kind="navigation"
          label="View public profile"
          description="See what other people see"
          onClick={() => navigate("/profile")}
        />
        <SettingsRow
          kind="unavailable"
          label="Phone number"
          description="Add a phone number for sign-in and recovery"
          note="JHILIK profiles don't store phone numbers yet, so there is nothing to add or verify."
        />
      </SettingsGroup>

      <SettingsGroup title="Sign-in & identity">
        <SettingsRow
          kind="information"
          label="Email"
          description={
            email
              ? "Used to sign in and recover your account"
              : "No email on this account"
          }
          value={email ?? "—"}
        />
        <SettingsRow
          kind="information"
          label="Sign-in method"
          value={loginMethod}
        />
        <SettingsRow
          kind="navigation"
          label="Password"
          description="Change the password you sign in with"
          onClick={() => navigate("/settings/security")}
        />
        <SettingsRow
          kind={google.linked ? "information" : "action"}
          label="Google account"
          description={
            google.linked
              ? "You can sign in with Google"
              : "Link Google to sign in without a password"
          }
          value={google.linked ? "Connected" : undefined}
          control={
            google.linked ? undefined : (
              <SettingsButton
                variant="ghost"
                busy={google.pending}
                onClick={() => void google.connect()}
              >
                <GoogleIcon size={14} /> Connect
              </SettingsButton>
            )
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Account type & status">
        <SettingsRow
          kind="information"
          label="Account type"
          value={accountTypeLabel(profile?.accountType)}
        />
        <SettingsRow
          kind="information"
          label="Verification"
          value={verificationLabel(
            verificationQuery.data?.verificationStatus,
            verificationQuery.data?.isVerified ?? profile?.isVerified
          )}
        />
        <SettingsRow
          kind="information"
          label="Role"
          value={roleLabel(user?.role)}
        />
        <SettingsRow
          kind="information"
          label="Member since"
          value={formatMemberSince(user?.createdAt)}
        />
      </SettingsGroup>

      <SettingsGroup title="Manage account">
        <SettingsRow
          kind="unavailable"
          label="Deactivate account"
          description="Hide your profile and posts while you take a break"
          note="Deactivation isn't implemented yet — your account stays active until it is."
        />
        <SettingsRow
          kind="unavailable"
          label="Delete account"
          description="Permanently remove your account and content"
          note="There is no account deletion endpoint in JHILIK yet, so we can't offer it here."
        />
        <SettingsRow
          kind="unavailable"
          label="Download your data"
          description="Export a copy of your posts and profile"
          note="Data export isn't supported by the JHILIK API yet."
        />
      </SettingsGroup>

      <SettingsNote tone="info">
        Every value here is read from your live JHILIK account. Rows marked
        “Not available yet” are waiting on backend support — they are never
        shown as working controls.
      </SettingsNote>

      <ProfileEditModal
        profile={snapshot}
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          void profileQuery.refetch();
        }}
      />
    </>
  );
}
