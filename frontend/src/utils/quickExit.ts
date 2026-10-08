// Quick Exit.
//
// Leaves Drive for a neutral site at once, the same way the hub's Quick Exit does: replace(), so
// Back does not return to this page. Before leaving it blanks the page, so a slow navigation does
// not leave her files on screen and a page restored from the back-forward cache comes back blank.
// It removes what Drive keeps in this browser, and signs out with a beacon, which the browser
// delivers even as the page goes away. Drive's earlier history entries in this tab cannot be
// removed by any page, but with the session ended they lead to a login screen, not her files.

import { clearLocalTraces } from "@/utils/auth";
import { getApiPath } from "@/utils/url.js";

// Same destination as the hub's Quick Exit.
const NEUTRAL_SITE = "https://www.cnn.com";

export function quickExit(): void {
  document.documentElement.style.display = "none";
  document.title = "";
  try {
    navigator.sendBeacon(getApiPath("api/auth/logout"));
  } catch {
    // No beacon support. The token still expires on its own.
  }
  clearLocalTraces();
  window.location.replace(NEUTRAL_SITE);
}
