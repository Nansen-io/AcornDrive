// Single logout, receiving end.
//
// When the person signs out at the Joliro hub, the hub loads this app's /api/auth/slo in a
// hidden iframe. That endpoint deletes this app's cookie and then announces on a same-origin
// BroadcastChannel that the session is over. This module is the listener: any Drive tab the
// person already has open hears the announcement and closes itself.
//
// Why a broadcast rather than the hub simply closing the tab. The hub opens tiles with
// window.open(url, "_blank", "noopener,noreferrer"), which returns null, so the hub never
// holds a reference to the tab and has no way to close it. Dropping "noopener" to get one
// back would hand every tile a live handle on the hub window, which is not a trade worth
// making. The hub's hidden iframe, on the other hand, is already on this app's origin --
// and same-origin is exactly BroadcastChannel's scope. It also reaches tabs the hub did not
// open, such as one the person opened from a bookmark.
//
// What this module is NOT. It is not the sign-out. The cookie deletion at /api/auth/slo is
// the sign-out, and it has already happened by the time any message arrives here. Closing
// the tab is the visible layer: it is what makes a sign-out look like one to the person
// standing in front of the screen. If the message never arrives, or the browser refuses
// window.close(), the session is over regardless.

const CHANNEL_NAME = "joliro-slo";

let handled = false;

// Wording is plain and unhurried on purpose. Someone may be reading this over the shoulder
// of the person who owns the account, and the screen should give away nothing about what
// was on it a moment ago. It states what happened, and it is not a login form -- there is
// no button here promising a way back in without a password.
//
// English only for now. Drive has vue-i18n, but this runs after the session has ended and
// should not depend on the app still being in a working state. Translating it is worth
// doing separately.
const HEADING = "You have been signed out";
const BODY = "Joliro Drive is closed in this browser. You can close this tab.";

function clearTheScreen(): void {
  // Cover the page before attempting to close it, not after. window.close() is allowed to
  // fail, and if it does, whatever was on screen -- folder names, file names -- would stay
  // there. Clearing first means the worst case is a blank, calm tab rather than a listing
  // left open.
  try {
    document.title = HEADING;

    const overlay = document.createElement("div");
    overlay.setAttribute("role", "status");
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "background:#ffffff",
      "color:#1f2933",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "justify-content:center",
      "gap:0.75rem",
      "padding:2rem",
      "text-align:center",
      "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
    ].join(";");

    const heading = document.createElement("h1");
    heading.textContent = HEADING;
    heading.style.cssText = "margin:0;font-size:1.25rem;font-weight:600";

    const body = document.createElement("p");
    body.textContent = BODY;
    body.style.cssText =
      "margin:0;font-size:1rem;max-width:28rem;line-height:1.5";

    overlay.appendChild(heading);
    overlay.appendChild(body);
    document.body.appendChild(overlay);
  } catch {
    // If the DOM is in a state where this fails there is nothing useful to fall back to,
    // and the sign-out itself has already happened on the server.
  }
}

function onSignedOut(): void {
  if (handled) return;
  handled = true;

  clearTheScreen();

  // window.close() only works on a tab that a script opened, which is how the hub opens
  // tiles. A tab the person opened themselves, from a bookmark or by typing the address,
  // will refuse it silently -- no error, nothing to catch. That refusal is why the screen
  // is cleared above rather than relying on this line.
  try {
    window.close();
  } catch {
    // Ignore. The overlay is already showing.
  }
}

export function listenForSingleLogout(): void {
  if (typeof BroadcastChannel === "undefined") return;

  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", (event: MessageEvent) => {
      // BroadcastChannel is same-origin by definition, so there is no cross-origin sender
      // to guard against. The type check is only so an unrelated message on a
      // same-named channel cannot blank someone's screen by accident.
      if (event.data && event.data.type === "signed-out") {
        onSignedOut();
      }
    });
  } catch {
    // Some privacy modes throw on construction. Nothing here is load-bearing.
  }
}
