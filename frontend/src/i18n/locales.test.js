import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import i18n, { detectLocale } from "@/i18n";

// What this file is protecting.
//
// joliroDrive adds its own strings (SAFEMode, Quick Exit, the idle sign-out warning, the share
// password) to en.json. Upstream never translated them, so every language Drive offers showed
// them in English. And a language can be listed in the picker without its messages being
// registered, or registered under a key the browser never reports (Ukrainian is "uk" to the
// browser and "ua" here), which leaves someone in the fallback language without saying why.

const JOLIRO_LANGUAGES = ["it", "pl", "ua", "ro", "nl", "el"];

// The JSON as written: the vite plugin compiles imported messages, so read the files themselves.
const readLocale = (code) => JSON.parse(fs.readFileSync(path.resolve(__dirname, `${code}.json`), "utf8"));

const flatten = (obj, prefix = "", out = {}) => {
  for (const [key, value] of Object.entries(obj)) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") flatten(value, keyPath, out);
    else out[keyPath] = value;
  }
  return out;
};
const placeholders = (s) => (String(s).match(/\{[^}]*\}/g) || []).sort().join(",");

const pickerLocales = () => {
  const vue = fs.readFileSync(path.resolve(__dirname, "../components/settings/Languages.vue"), "utf8");
  const block = vue.match(/locales:\s*\{([\s\S]*?)\}/)[1];
  return [...block.matchAll(/^\s*([A-Za-z]+):/gm)].map((m) => m[1]);
};

describe("joliroDrive languages", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(JOLIRO_LANGUAGES)("%s has every en.json key, none blank, placeholders intact", (code) => {
    const target = flatten(readLocale(code));
    const master = flatten(readLocale("en"));
    const problems = [];
    for (const [key, value] of Object.entries(master)) {
      if (!(key in target)) problems.push(`missing ${key}`);
      else if (String(target[key]).trim() === "") problems.push(`blank ${key}`);
      else if (placeholders(target[key]) !== placeholders(value)) problems.push(`placeholders ${key}`);
    }
    for (const key of Object.keys(target)) if (!(key in master)) problems.push(`extra ${key}`);
    expect(problems).toEqual([]);
  });

  it.each(JOLIRO_LANGUAGES)("%s is in the language picker and registered", (code) => {
    expect(pickerLocales()).toContain(code);
    expect(i18n.global.availableLocales).toContain(code);
  });

  it.each([
    ["it-IT", "it"],
    ["pl-PL", "pl"],
    ["uk-UA", "ua"],
    ["uk", "ua"],
    ["ro-RO", "ro"],
    ["nl-NL", "nl"],
    ["nl", "nl"],
    ["nl-BE", "nlBE"],
    ["el-GR", "el"],
  ])("a browser set to %s opens Drive in %s", (language, expected) => {
    vi.stubGlobal("navigator", { language });
    expect(detectLocale()).toBe(expected);
    expect(i18n.global.availableLocales).toContain(expected);
  });
});
