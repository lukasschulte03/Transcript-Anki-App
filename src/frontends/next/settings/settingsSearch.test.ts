import { describe, expect, it } from "vitest";
import { normalizeSettingsSearch, searchSettings } from "./settingsSearch";

describe("settings search", () => {
  it("normalizes Swedish diacritics and punctuation", () => {
    expect(normalizeSettingsSearch("Färgtema – återställning")).toEqual([
      "fargtema",
      "aterstallning",
    ]);
  });

  it("finds controls through common alternate terms", () => {
    expect(
      searchSettings("grafikkort").map((result) => result.target),
    ).toContain("transcription-acceleration");
    expect(
      searchSettings("säkerhetskopia").map((result) => result.target),
    ).toContain("library-export");
    expect(
      searchSettings("google mapp").map((result) => result.target),
    ).toContain("drive-folder");
  });

  it("supports partial words and a one-character typo", () => {
    expect(searchSettings("whisp").map((result) => result.target)).toContain(
      "whisper-model",
    );
    expect(
      searchSettings("transkibering").map((result) => result.target),
    ).toContain("transcription-method");
  });

  it("requires all query words and returns no results for unrelated text", () => {
    expect(searchSettings("anki färg")).toEqual([]);
    expect(searchSettings("zzqv")).toEqual([]);
  });
});
