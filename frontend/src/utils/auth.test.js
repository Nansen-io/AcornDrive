import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// What this file is protecting.
//
// Signing out of Drive has to end differently depending on how the person got here, and the
// difference is invisible from inside the code: the browser decides it. If the Joliro hub
// opened this tab, closing it returns the person to the hub, still signed in. If they opened
// Drive themselves there is no hub tab to return to, so they get the B2C sign-out and the
// login screen, exactly as before.
//
// Both halves fail quietly if they break. A close that is never attempted just leaves the old
// login-screen behaviour, which looks fine in a screenshot and is the confusion we are removing.
// A fallback that never fires strands someone on a dead page with no way back in. jsdom cannot
// close its own window, so what is testable here is the refused case -- which is also the one
// that must never regress, because it is the case where the person is still relying on the
// B2C sign-out to actually end their session.

vi.mock("@/store", () => ({
  state: { user: {}, sessionId: "test" },
  mutations: { setCurrentUser: vi.fn(), setSession: vi.fn() },
  getters: { isLoggedIn: vi.fn(), isShare: vi.fn(() => false) },
}));

vi.mock("@/utils/constants", () => ({
  globalVars: { baseURL: "/", recaptcha: false, noAuth: false },
}));

vi.mock("@/utils/url.js", () => ({
  getApiPath: (p) => "/" + p,
  getPublicApiPath: (p) => "/" + p,
}));

const { logout } = await import("@/utils/auth.js");

const B2C_SIGN_OUT =
  "https://nansenprod.b2clogin.com/nansenprod.onmicrosoft.com/B2C_1_signup_signin/oauth2/v2.0/logout";

let closeSpy;
let assignedHref;

function mockLogoutResponse(body) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  assignedHref = null;

  closeSpy = vi.fn();
  window.close = closeSpy;

  // jsdom refuses a real navigation, so capture the assignment instead.
  delete window.location;
  window.location = {
    set href(value) {
      assignedHref = value;
    },
    get href() {
      return assignedHref;
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("logout", () => {
  it("asks the browser to close the tab", async () => {
    mockLogoutResponse({ logoutUrl: B2C_SIGN_OUT });

    await logout();

    // If this stops happening, a tile opened from the hub goes back to leaving two tabs open
    // with a login screen in the second one.
    expect(closeSpy).toHaveBeenCalled();
  });

  it("attempts the close before starting any navigation", async () => {
    mockLogoutResponse({ logoutUrl: B2C_SIGN_OUT });

    await logout();

    // Navigating first would take the tab to B2C and end the hub's session too, which is the
    // opposite of what a tile's own sign-out is meant to do.
    expect(assignedHref).toBeNull();
    expect(closeSpy).toHaveBeenCalled();
  });

  it("falls back to the B2C sign-out when the close is refused", async () => {
    mockLogoutResponse({ logoutUrl: B2C_SIGN_OUT });

    await logout();
    vi.runAllTimers();

    // A tab the person opened themselves refuses window.close() silently -- no throw, no event.
    // The only way back from that is this timer, so it has to survive.
    expect(assignedHref).toBe(B2C_SIGN_OUT);
  });

  it("falls back even when close throws instead of refusing quietly", async () => {
    mockLogoutResponse({ logoutUrl: B2C_SIGN_OUT });
    window.close = vi.fn(() => {
      throw new Error(
        "Scripts may close only the windows that were opened by them.",
      );
    });

    await logout();
    vi.runAllTimers();

    expect(assignedHref).toBe(B2C_SIGN_OUT);
  });

  it("still has somewhere to send the person when the server returns no sign-out URL", async () => {
    mockLogoutResponse({});

    await logout();
    vi.runAllTimers();

    // Without this the fallback would navigate to undefined and the person would be left on a
    // broken page after their session had already ended.
    expect(assignedHref).toBe("/login");
  });
});
