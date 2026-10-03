import { SettingsGroup, SettingsNote, SettingsRow } from "./atoms";

export default function ContentPane() {
  return (
    <>
      <div className="settings-pane__header">
        <p className="settings-pane__eyebrow">Content & feed</p>
        <h2 className="settings-pane__title">Tune what you watch</h2>
        <p className="settings-pane__subtitle">
          Feed, media and history controls only appear here once something in
          JHILIK actually reads them. Right now nothing does, so every row is
          marked unavailable rather than switched on behind your back.
        </p>
      </div>

      <SettingsGroup title="Content preferences">
        <SettingsRow
          kind="unavailable"
          label="Sensitive content"
          description="Reduce posts marked sensitive in your feed"
          note="Posts carry no sensitivity flag, so there is nothing to filter."
        />
        <SettingsRow
          kind="unavailable"
          label="Suggested content"
          description="Show or hide recommendations in For You"
          note="The feed is chronological — there is no recommendation preference to store."
        />
        <SettingsRow
          kind="unavailable"
          label="Content language"
          description="Prioritise posts in the languages you read"
          note="Languages are free-text profile data and are not used for ranking."
        />
      </SettingsGroup>

      <SettingsGroup title="Playback & data">
        <SettingsRow
          kind="unavailable"
          label="Autoplay"
          description="Choose whether videos start automatically"
          note="Feed and Shorts autoplay from viewport visibility; the behaviour is not configurable yet."
        />
        <SettingsRow
          kind="unavailable"
          label="Media quality"
          description="Pick standard or high quality streaming"
          note="HLS renditions are selected by the player, not by a user preference."
        />
        <SettingsRow
          kind="unavailable"
          label="Data saver"
          description="Load fewer videos on mobile data"
          note="No data-saver flag exists in the client or the API yet."
        />
      </SettingsGroup>

      <SettingsGroup title="History">
        <SettingsRow
          kind="unavailable"
          label="Recommendation & search history"
          description="Clear what JHILIK has learned from your activity"
          note="Search and watch history are not stored per user, so there is nothing to clear."
        />
        <SettingsRow
          kind="unavailable"
          label="Watch history"
          description="Review or remove videos you have watched"
          note="Views are counted for analytics only and are not attached to a browsable history."
        />
      </SettingsGroup>

      <SettingsNote>
        Saved posts and bookmarks are already available under{" "}
        <strong>Saved</strong> in the main menu — they are a feature, not a
        preference, so they live outside this screen.
      </SettingsNote>
    </>
  );
}
