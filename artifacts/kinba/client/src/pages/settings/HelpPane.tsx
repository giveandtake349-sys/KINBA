import { version as appVersion } from "../../../../package.json";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default function HelpPane() {
  const { isAuthenticated } = useAuth();

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

  const snapshot = profileQuery.data;

  return (
    <>
      <div className="settings-pane__header">
        <p className="settings-pane__eyebrow">Help & account status</p>
        <h2 className="settings-pane__title">Where you stand</h2>
        <p className="settings-pane__subtitle">
          Your account status as JHILIK stores it, plus how to get help today.
        </p>
      </div>

      <SettingsGroup title="Account status" plain>
        {profileQuery.isPending ? (
          <SettingsState kind="loading" message="Loading account status…" />
        ) : profileQuery.isError || !snapshot ? (
          <SettingsState
            kind="error"
            message="We couldn't load your account status."
            onRetry={() => void profileQuery.refetch()}
          />
        ) : (
          <dl className="settings-facts">
            <Fact
              label="Account type"
              value={accountTypeLabel(snapshot.profile?.accountType)}
            />
            <Fact
              label="Verification"
              value={verificationLabel(
                verificationQuery.data?.verificationStatus,
                verificationQuery.data?.isVerified ??
                  snapshot.profile?.isVerified
              )}
            />
            <Fact label="Role" value={roleLabel(snapshot.user?.role)} />
            <Fact
              label="Sign-in"
              value={
                snapshot.user?.loginMethod === "supabase"
                  ? "Email or Google"
                  : (snapshot.user?.loginMethod ?? "—")
              }
            />
            <Fact label="Email" value={snapshot.user?.email ?? "—"} />
            <Fact
              label="Member since"
              value={formatMemberSince(snapshot.user?.createdAt)}
            />
          </dl>
        )}
      </SettingsGroup>

      <SettingsGroup title="Restrictions">
        <SettingsRow
          kind="unavailable"
          label="Standing & restrictions"
          description="See strikes, mutes or bans applied to your account"
          note="Moderation actions are only readable by admins — JHILIK has no self-serve status endpoint."
        />
      </SettingsGroup>

      <SettingsGroup title="Getting help">
        <SettingsRow
          kind="unavailable"
          label="Report a problem"
          description="Send a bug or abuse report to the JHILIK team"
          note="The report API requires a target (profile, room, message or drop). There is no general support ticket, so we don't show a fake form."
        />
        <SettingsRow
          kind="unavailable"
          label="Community guidelines"
          description="Read the rules that keep JHILIK safe"
          note="No guidelines page exists in the app yet."
        />
        <SettingsRow
          kind="unavailable"
          label="Privacy policy"
          description="How JHILIK handles your data"
          note="No privacy policy page is published in the app yet."
        />
        <SettingsRow
          kind="unavailable"
          label="Terms of service"
          description="The agreement you accept when using JHILIK"
          note="No terms page is published in the app yet."
        />
      </SettingsGroup>

      <SettingsGroup title="About">
        <dl className="settings-facts">
          <Fact label="App" value="JHILIK" />
          <Fact label="Version" value={appVersion} />
          <Fact
            label="Build"
            value={import.meta.env.DEV ? "Development" : "Production"}
          />
          <Fact label="Platform" value="Web" />
        </dl>
      </SettingsGroup>

      <SettingsNote tone="info">
        To flag a specific profile, room, drop or message, use the report
        option in that item's menu — those go straight to the moderation queue.
      </SettingsNote>
    </>
  );
}
