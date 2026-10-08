import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// What this file is protecting.
//
// Every part of the idle sign-out fails quietly. A timer that never fires leaves her files open on
// a machine she walked away from. A restored browser that skips the boot check reopens on her
// files. And a fresh sign-in that is mistaken for a stale one throws her out straight after she
// typed her password and MFA code, which teaches her the sign-out cannot be trusted.

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

vi.mock("@/utils/slo", () => ({
  clearTheScreen: vi.fn(),
}));

const KEY = "joliro-drive-last-activity";
const FORWARD = "joliro-drive-idle-signout";
const HUB = "https://www.joliro.org/login?signedOut=idle";
const B2C_SIGN_OUT = "https://nansenprod.b2clogin.com/logout";
const MINUTE = 60 * 1000;

let replaced;
let idleModule;

async function loadIdle() {
  vi.resetModules();
  idleModule = await import("@/utils/idle");
  return idleModule;
}

function setPath(pathname) {
  delete window.location;
  window.location = {
    pathname,
    replace: (url) => {
      replaced = url;
    },
  };
}

function clearCookie(name) {
  document.cookie = `${name}=; Max-Age=0; path=/`;
}

beforeEach(() => {
  vi.useFakeTimers();
  replaced = null;
  localStorage.clear();
  sessionStorage.clear();
  clearCookie("drive_new_session");
  setPath("/files/");
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ logoutUrl: B2C_SIGN_OUT }),
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("checkIdleOnBoot", () => {
  it("signs out a restored session that was left idle, before anything is drawn", async () => {
    localStorage.setItem(KEY, String(Date.now() - 31 * MINUTE));
    const { checkIdleOnBoot } = await loadIdle();

    expect(checkIdleOnBoot()).toBe(true);
    await vi.waitFor(() => expect(replaced).toBe(B2C_SIGN_OUT));

    expect(global.fetch).toHaveBeenCalledWith("/api/auth/logout", expect.anything());
    expect(sessionStorage.getItem(FORWARD)).toBe("1");
  });

  it("does not sign out a fresh sign-in after an earlier session was abandoned", async () => {
    localStorage.setItem(KEY, String(Date.now() - 3 * 60 * MINUTE));
    document.cookie = "drive_new_session=1; path=/";
    const { checkIdleOnBoot } = await loadIdle();

    expect(checkIdleOnBoot()).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(Date.now() - Number(localStorage.getItem(KEY))).toBeLessThan(1000);
    // Read once. Left in place it would excuse the next stale reload too.
    expect(document.cookie).not.toContain("drive_new_session=1");
  });

  it("forwards to the hub when B2C returns the tab after an idle sign-out", async () => {
    sessionStorage.setItem(FORWARD, "1");
    const { checkIdleOnBoot } = await loadIdle();

    expect(checkIdleOnBoot()).toBe(true);
    expect(replaced).toBe(HUB);
    expect(sessionStorage.getItem(FORWARD)).toBeNull();
  });

  it("leaves a public share alone", async () => {
    localStorage.setItem(KEY, String(Date.now() - 31 * MINUTE));
    setPath("/public/share/abc");
    const { checkIdleOnBoot } = await loadIdle();

    expect(checkIdleOnBoot()).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("lets a recently active session load", async () => {
    localStorage.setItem(KEY, String(Date.now() - 5 * MINUTE));
    const { checkIdleOnBoot } = await loadIdle();

    expect(checkIdleOnBoot()).toBe(false);
  });
});

describe("startIdleTimer", () => {
  it("warns for the last five minutes, then signs out", async () => {
    const { startIdleTimer, idle } = await loadIdle();
    startIdleTimer();

    vi.advanceTimersByTime(24 * MINUTE);
    expect(idle.warning).toBe(false);

    vi.advanceTimersByTime(1 * MINUTE + 1000);
    expect(idle.warning).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5 * MINUTE);
    expect(global.fetch).toHaveBeenCalledWith("/api/auth/logout", expect.anything());
  });

  it("does not let a moved mouse cancel the warning, but a key press does", async () => {
    const { startIdleTimer, idle } = await loadIdle();
    startIdleTimer();
    vi.advanceTimersByTime(26 * MINUTE);
    expect(idle.warning).toBe(true);

    window.dispatchEvent(new Event("mousemove"));
    vi.advanceTimersByTime(1000);
    expect(idle.warning).toBe(true);

    window.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(1000);
    expect(idle.warning).toBe(false);
  });

  it("counts activity in another Drive tab", async () => {
    const { startIdleTimer, idle } = await loadIdle();
    startIdleTimer();
    vi.advanceTimersByTime(26 * MINUTE);
    expect(idle.warning).toBe(true);

    localStorage.setItem(KEY, String(Date.now()));
    vi.advanceTimersByTime(1000);
    expect(idle.warning).toBe(false);
  });
});
