import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  isReducedMotion,
  setReducedMotion,
} from "@/contexts/motionPreference";
import { useState } from "react";
import {
  SettingsGroup,
  SettingsNote,
  SettingsRow,
  SettingsSegmented,
  SettingsSwitch,
} from "./atoms";

export default function AppearancePane() {
  const { mode, setMode, theme, switchable } = useTheme();
  const [reducedMotion, setReducedMotionState] = useState(() =>
    isReducedMotion()
  );

  const toggleMotion = (next: boolean) => {
    setReducedMotion(next);
    setReducedMotionState(next);
  };

  return (
    <>
      <div className="settings-pane__header">
        <p className="settings-pane__eyebrow">Appearance & accessibility</p>
        <h2 className="settings-pane__title">Make JHILIK comfortable</h2>
        <p className="settings-pane__subtitle">
          Theme and motion are stored in this browser and apply immediately —
          no account or server round trip.
        </p>
      </div>

      <SettingsGroup title="Theme">
        <SettingsRow
          kind="action"
          label="App theme"
          description={
            mode === "system"
              ? "Follows your device light or dark setting"
              : theme === "dark"
                ? "Obsidian dark palette"
                : "Warm light palette"
          }
          control={
            <SettingsSegmented
              label="App theme"
              value={mode}
              onChange={setMode}
              disabled={!switchable}
              options={[
                { value: "light", label: "Light", icon: <Sun size={14} /> },
                { value: "dark", label: "Dark", icon: <Moon size={14} /> },
                {
                  value: "system",
                  label: "System",
                  icon: <Monitor size={14} />,
                },
              ]}
            />
          }
        />
        <SettingsRow
          kind="action"
          label="Reduced motion"
          description="Minimise animations, transitions and auto-scrolling"
          note="Saved in this browser only — it travels with the device, not the account."
          onClick={() => toggleMotion(!reducedMotion)}
          control={
            <SettingsSwitch
              label="Reduced motion"
              checked={reducedMotion}
              onChange={toggleMotion}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Accessibility">
        <SettingsRow
          kind="unavailable"
          label="Text size"
          description="Make type larger or smaller across the app"
          note="The interface is laid out in fixed pixel sizes, so a text scaler needs a typography pass first."
        />
        <SettingsRow
          kind="unavailable"
          label="Compact or comfortable layout"
          description="Change how much content fits on screen"
          note="Feed density is baked into the existing components and is not switchable yet."
        />
        <SettingsRow
          kind="unavailable"
          label="Accent colour"
          description="Pick a different highlight colour"
          note="JHILIK ships a single accent palette; there is no theme token override."
        />
      </SettingsGroup>

      <SettingsNote tone="info">
        Device-level reduced motion is always respected — this switch only adds
        an in-app override on top of it.
      </SettingsNote>
    </>
  );
}
