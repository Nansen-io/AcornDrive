// Idle sign-out.
//
// Drive signs out after thirty minutes without activity, with a warning for the last five,
// matching Mail, Diary, Detect and the hub. It lands on the hub's sign-in page with
// ?signedOut=idle, so getting back in needs a password and an MFA code, and the hub says why
// she is looking at a login screen.
//
// The sign-out has two legs. First Drive's own logout: the server revokes the token, deletes
// the cookie and returns the B2C end-session URL. Following that URL ends the B2C session too;
// without it, Drive's Login button would sign straight back in with no password. B2C can only
// return the tab to Drive's /login, so a sessionStorage flag set before leaving tells this module,
// when the tab comes back, to forward on to the hub. sessionStorage belongs to the tab and
// survives the trip to B2C and back.
//
// Last activity is kept in localStorage rather than memory for two reasons. Every Drive tab
// shares it, so typing in one tab keeps the others open. And it outlives the tab, so a browser
// that restores the session cookie on reopening is still signed out once thirty minutes have
// passed, instead of reopening on her files. A fresh sign-in is told apart from a restored
// session by the drive_new_session cookie the server sets at every real sign-in.

import { reactive } from "vue";
import { clearLocalTraces, LAST_ACTIVITY_KEY } from "@/utils/auth";
import { clearTheScreen } from "@/utils/slo";
import { getApiPath } from "@/utils/url.js";
import { globalVars } from "@/utils/constants";

export const IDLE_MS = 30 * 60 * 1000;
export const WARNING_MS = 5 * 60 * 1000;
const TICK_MS = 1000;
const WRITE_THROTTLE_MS = 1000;

// A literal, like the hub's own list of sign-out addresses: a missing or stale variable would
// fail silently into a sign-out that lands somewhere asking for nothing.
const HUB_SIGNED_OUT_URL = "https://www.joliro.org/login?signedOut=idle";
const FORWARD_KEY = "joliro-drive-idle-signout";
const NEW_SESSION_COOKIE = "drive_new_session";

const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "touchstart", "scroll", "wheel", "click"];

// Read by IdleWarning.vue.
export const idle = reactive({ warning: false, remainingMs: IDLE_MS });

let lastActivity = Date.now();
let lastWrite = 0;
let started = false;
let signingOut = false;

function readStoredActivity(): number | null {
  try {
    const value = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}

function storeActivity(at: number): void {
  lastWrite = at;
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(at));
  } catch {
    // Storage blocked. This tab's own clock still runs.
  }
}

function takeNewSessionMarker(): boolean {
  const present = document.cookie.split("; ").some((c) => c === `${NEW_SESSION_COOKIE}=1`);
  if (present) {
    document.cookie = `${NEW_SESSION_COOKIE}=; Max-Age=0; path=${globalVars.baseURL}`;
  }
  return present;
}

export function recordActivity(): void {
  const now = Date.now();
  lastActivity = now;
  if (now - lastWrite >= WRITE_THROTTLE_MS) storeActivity(now);
}

function onActivity(event: Event): void {
  // Once the warning is showing, a moved mouse no longer counts. It is the one event that
  // happens to the page rather than being done to it -- a nudged desk, or someone else at the
  // computer cancelling a warning meant to protect her. Keys, clicks, taps and scrolls still do.
  if (idle.warning && event.type === "mousemove") return;
  recordActivity();
}

function tick(): void {
  const stored = readStoredActivity();
  const last = Math.max(lastActivity, stored ?? 0);
  const idleFor = Date.now() - last;
  if (idleFor >= IDLE_MS) {
    void signOutForInactivity();
    return;
  }
  idle.remainingMs = IDLE_MS - idleFor;
  idle.warning = idleFor >= IDLE_MS - WARNING_MS;
}

export async function signOutForInactivity(): Promise<void> {
  if (signingOut) return;
  signingOut = true;

  // Cover first. If the request or the navigation below stalls, her files are not left on screen.
  clearTheScreen();
  clearLocalTraces();

  let destination = HUB_SIGNED_OUT_URL;
  try {
    const res = await fetch(getApiPath("api/auth/logout"), { method: "POST", credentials: "same-origin" });
    if (res.ok) {
      const data = await res.json();
      if (data.logoutUrl) destination = data.logoutUrl;
    }
  } catch {
    // Network failure. Go straight to the hub; the token expires on its own.
  }
  if (destination !== HUB_SIGNED_OUT_URL) {
    try {
      sessionStorage.setItem(FORWARD_KEY, "1");
    } catch {
      // Without the flag she lands on Drive's login page instead of the hub's. Still signed out.
    }
  }
  window.location.replace(destination);
}

// Runs before the app mounts. Returns true when the tab is already leaving and nothing should
// be drawn.
export function checkIdleOnBoot(): boolean {
  try {
    if (sessionStorage.getItem(FORWARD_KEY)) {
      sessionStorage.removeItem(FORWARD_KEY);
      window.location.replace(HUB_SIGNED_OUT_URL);
      return true;
    }
  } catch {
    // Storage blocked; nothing was set either.
  }

  if (takeNewSessionMarker()) {
    storeActivity(Date.now());
    return false;
  }

  // A public share is not her session. Someone opening a share link on this computer must not
  // be sent to the hub because an earlier Drive session here was left idle.
  if (window.location.pathname.startsWith(`${globalVars.baseURL}public/`)) return false;

  const stored = readStoredActivity();
  if (stored !== null && Date.now() - stored >= IDLE_MS) {
    void signOutForInactivity();
    return true;
  }
  return false;
}

// Starts the clock for a signed-in session. Safe to call more than once.
export function startIdleTimer(): void {
  if (started) return;
  started = true;

  // Password sign-in happens after boot, so its marker can still be waiting here.
  const stored = readStoredActivity();
  if (takeNewSessionMarker() || stored === null) {
    lastActivity = Date.now();
    storeActivity(lastActivity);
  } else {
    lastActivity = stored;
  }

  for (const name of ACTIVITY_EVENTS) {
    window.addEventListener(name, onActivity, { capture: true, passive: true });
  }
  // Background tabs have their timers slowed. Elapsed time is measured, not counted, so a tab
  // that wakes after the deadline signs out on its first tick.
  document.addEventListener("visibilitychange", tick);
  window.setInterval(tick, TICK_MS);
  tick();
}
