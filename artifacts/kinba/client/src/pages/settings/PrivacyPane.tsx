import { SettingsGroup, SettingsNote, SettingsRow } from "./atoms";

export default function PrivacyPane() {
  return (
    <>
      <div className="settings-pane__header">
        <p className="settings-pane__eyebrow">Privacy</p>
        <h2 className="settings-pane__title">Who can see and reach you</h2>
        <p className="settings-pane__subtitle">
          JHILIK profiles are public today. Private accounts and interaction
          controls need server-side privacy rules that do not exist yet, so
          nothing here is faked.
        </p>
      </div>

      <SettingsGroup title="Account privacy">
        <SettingsRow
          kind="unavailable"
          label="Private account"
          description="Only approved followers can see your posts"
          note="Needs a privacy flag enforced across feed, profile and search — no such rule exists in the API today."
        />
        <SettingsRow
          kind="unavailable"
          label="Profile discoverability"
          description="Choose whether your profile appears in search"
          note="Search reads public profile data; there is no visibility flag to honour."
        />
      </SettingsGroup>

      <SettingsGroup title="Interactions">
        <SettingsRow
          kind="unavailable"
          label="Follow requests"
          description="Approve people before they follow you"
          note="Follows are applied immediately in JHILIK — there is no pending state."
        />
        <SettingsRow
          kind="unavailable"
          label="Mentions & tags"
          description="Control who can mention or tag you"
          note="Mentions are not stored as a per-user preference yet."
        />
        <SettingsRow
          kind="unavailable"
          label="Activity status"
          description="Show when you are active or recently online"
          note="JHILIK has no presence service, so there is nothing to switch off."
        />
        <SettingsRow
          kind="unavailable"
          label="Search engine indexing"
          description="Allow search engines to link to your profile"
          note="Sitemap and crawler rules are handled outside the app."
        />
      </SettingsGroup>

      <SettingsNote>
        Messaging privacy lives under <strong>Messaging</strong>, and blocking
        lives under <strong>Security</strong>. Those are the only interaction
        controls JHILIK enforces today.
      </SettingsNote>
    </>
  );
}
