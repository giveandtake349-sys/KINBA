import { describe, expect, it } from "vitest";
import { translate, type Language } from "../client/src/contexts/LanguageContext";

describe("NIVO language translations", () => {
  it("provides distinct navigation labels for all supported languages", () => {
    const languages: Language[] = ["en", "bn", "hi"];
    expect(languages.map((language) => translate(language, "discover"))).toEqual(["Discover", "আবিষ্কার", "खोजें"]);
    expect(languages.map((language) => translate(language, "connect"))).toEqual(["Connect", "সংযোগ করুন", "कनेक्ट करें"]);
  });

  it("translates core guest and app content without empty strings", () => {
    for (const language of ["en", "bn", "hi"] as Language[]) {
      expect(translate(language, "searchSignals").length).toBeGreaterThan(0);
      expect(translate(language, "getStarted").length).toBeGreaterThan(0);
      expect(translate(language, "liveNetwork").length).toBeGreaterThan(0);
    }
  });
});
