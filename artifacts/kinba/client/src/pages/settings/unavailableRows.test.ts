/**
 * Guard against fake settings controls.
 *
 * Every `kind="unavailable"` row in the Account Center must explain *why* it
 * is unavailable and must not carry any interactivity — otherwise the screen
 * would look like it can change something the backend does not support.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PANE_DIR = import.meta.dirname;
const PANE_FILES = readdirSync(PANE_DIR)
  .filter(
    file =>
      file.endsWith("Pane.tsx") && !file.endsWith(".test.tsx")
  )
  .sort();

function unavailableBlocks(source: string): string[] {
  return source
    .split("<SettingsRow")
    .slice(1)
    .map(block => block.split("<SettingsRow")[0])
    .filter(block => block.includes('kind="unavailable"'));
}

describe("unavailable settings rows", () => {
  it("scans every settings pane", () => {
    expect(PANE_FILES).toEqual([
      "AccountPane.tsx",
      "AppearancePane.tsx",
      "ContentPane.tsx",
      "DataPane.tsx",
      "HelpPane.tsx",
      "MessagingPane.tsx",
      "NotificationsPane.tsx",
      "PrivacyPane.tsx",
      "SecurityPane.tsx",
    ]);
  });

  it("always explains why a setting is unavailable", () => {
    const missing: string[] = [];
    for (const file of PANE_FILES) {
      const source = readFileSync(path.join(PANE_DIR, file), "utf8");
      for (const block of unavailableBlocks(source)) {
        if (!block.includes("note=")) {
          const label = block.match(/label="([^"]+)"/)?.[1] ?? "?";
          missing.push(`${file}: ${label}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("never wires click or change handlers into unavailable rows", () => {
    const wired: string[] = [];
    for (const file of PANE_FILES) {
      const source = readFileSync(path.join(PANE_DIR, file), "utf8");
      for (const block of unavailableBlocks(source)) {
        if (
          block.includes("onClick=") ||
          block.includes("onChange=") ||
          block.includes("control=")
        ) {
          const label = block.match(/label="([^"]+)"/)?.[1] ?? "?";
          wired.push(`${file}: ${label}`);
        }
      }
    }
    expect(wired).toEqual([]);
  });

  it("keeps at least one real (non-unavailable) row or control per pane", () => {
    const empty: string[] = [];
    for (const file of PANE_FILES) {
      const source = readFileSync(path.join(PANE_DIR, file), "utf8");
      const rows = source.split("<SettingsRow").slice(1);
      const live = rows.filter(
        block =>
          !block.split("<SettingsRow")[0].includes('kind="unavailable"')
      );
      const hasFormOrList =
        source.includes("<Settings") ||
        source.includes("settings-facts") ||
        source.includes("settings-mini-list") ||
        source.includes("ProfileEditModal");
      if (live.length === 0 && !hasFormOrList) empty.push(file);
    }
    expect(empty).toEqual([]);
  });
});
