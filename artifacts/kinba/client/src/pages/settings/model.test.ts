import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPE_LABELS,
  DEFAULT_SECTION,
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_IDS,
  UNAVAILABLE_LABEL,
  accountTypeLabel,
  findSection,
  formatMemberSince,
  isSettingsSectionId,
  roleLabel,
  sectionPath,
  verificationLabel,
} from "./model";

describe("settings sections", () => {
  it("exposes the nine Account Center categories in product order", () => {
    expect(SETTINGS_SECTIONS.map(section => section.id)).toEqual([
      "account",
      "privacy",
      "security",
      "notifications",
      "messaging",
      "content",
      "appearance",
      "data",
      "help",
    ]);
  });

  it("keeps ids and the exported id list in sync", () => {
    expect(SETTINGS_SECTIONS.map(section => section.id)).toEqual([
      ...SETTINGS_SECTION_IDS,
    ]);
  });

  it("labels every category and describes what it contains", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.description.length).toBeGreaterThan(10);
      expect(section.icon).toBeTruthy();
    }
  });

  it("routes unknown section ids back to the default pane", () => {
    expect(findSection("nope" as never).id).toBe(DEFAULT_SECTION);
    expect(findSection("help").id).toBe("help");
  });

  it("only accepts known section ids", () => {
    expect(isSettingsSectionId("security")).toBe(true);
    expect(isSettingsSectionId("notifications")).toBe(true);
    expect(isSettingsSectionId(" SETTINGS")).toBe(false);
    expect(isSettingsSectionId(undefined)).toBe(false);
  });

  it("builds deep links for each category", () => {
    expect(sectionPath("privacy")).toBe("/settings/privacy");
    expect(sectionPath("account")).toBe("/settings/account");
  });

  it("uses the standard unavailable badge copy", () => {
    expect(UNAVAILABLE_LABEL).toBe("Not available yet");
  });
});

describe("account status labels", () => {
  it("maps stored account types to readable names", () => {
    expect(Object.keys(ACCOUNT_TYPE_LABELS)).toEqual([
      "member",
      "creator",
      "company",
    ]);
    expect(accountTypeLabel("creator")).toBe("Creator");
    expect(accountTypeLabel(null)).toBe("Member");
    expect(accountTypeLabel("something-new")).toBe("something-new");
  });

  it("describes verification state from the stored enum first", () => {
    expect(verificationLabel("none", false)).toBe("Not verified");
    expect(verificationLabel("eligible", false)).toBe(
      "Free verification available"
    );
    expect(verificationLabel("pending", false)).toBe("Review in progress");
    expect(verificationLabel("verified", false)).toBe("Verified");
    expect(verificationLabel("official", false)).toBe("Verified");
    expect(verificationLabel("none", true)).toBe("Verified");
    expect(verificationLabel(undefined, undefined)).toBe("Not verified");
  });

  it("distinguishes administrators from members", () => {
    expect(roleLabel("admin")).toBe("Administrator");
    expect(roleLabel("user")).toBe("Member");
    expect(roleLabel(undefined)).toBe("Member");
  });

  it("renders member-since safely for missing or invalid dates", () => {
    expect(formatMemberSince(null)).toBe("—");
    expect(formatMemberSince("not-a-date")).toBe("—");
    const formatted = formatMemberSince("2024-03-05T00:00:00.000Z");
    expect(formatted).toContain("2024");
    expect(formatted.length).toBeGreaterThan(6);
  });
});
