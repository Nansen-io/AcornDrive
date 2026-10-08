import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/store", () => ({
  state: { user: {}, sessionId: "test" },
  mutations: { setCurrentUser: vi.fn(), setSession: vi.fn() },
  getters: { isLoggedIn: vi.fn(), isShare: vi.fn(() => false) },
}));

vi.mock("@/utils/constants", () => ({
  globalVars: { baseURL: "/" },
}));

vi.mock("@/utils/url.js", () => ({
  getApiPath: (p) => "/" + p,
  getPublicApiPath: (p) => "/" + p,
}));

const { quickExit } = await import("@/utils/quickExit");

let replaced;

beforeEach(() => {
  replaced = null;
  document.documentElement.style.display = "";
  delete window.location;
  window.location = {
    replace: (url) => {
      replaced = url;
    },
  };
  navigator.sendBeacon = vi.fn(() => true);
});

describe("quickExit", () => {
  it("blanks the page, signs out, clears traces and leaves with replace()", () => {
    localStorage.setItem("displayPreferences", "{}");

    quickExit();

    // Blanked before leaving: a slow navigation, or a page restored by Back from the
    // back-forward cache, must not show her files.
    expect(document.documentElement.style.display).toBe("none");
    expect(navigator.sendBeacon).toHaveBeenCalledWith("/api/auth/logout");
    expect(localStorage.getItem("displayPreferences")).toBeNull();
    // replace(), not assign(): Back must not return to this page.
    expect(replaced).toBe("https://www.cnn.com");
  });

  it("still leaves when the beacon throws", () => {
    navigator.sendBeacon = vi.fn(() => {
      throw new Error("blocked");
    });

    quickExit();

    expect(replaced).toBe("https://www.cnn.com");
  });
});
