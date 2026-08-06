import { mutations, getters,state } from "@/store";
import { getApiPath, getPublicApiPath } from "@/utils/url.js";
import { globalVars } from "@/utils/constants";

export async function validateLogin() {
  // Use direct fetch to avoid automatic logout on 401
  let apiPath = getPublicApiPath('users', { id: 'self' });
  const res = await fetch(apiPath, {
    credentials: 'same-origin', // Ensure cookies are sent with the request
    headers: {
      "sessionId": state.sessionId,
    }
  });

  if (res.status !== 200) {
    throw new Error(`{"status":${res.status},"message":"${await res.text()}"}`);
  }

  const userInfo = await res.json();
  mutations.setCurrentUser(userInfo);
  getters.isLoggedIn()
  if (state.user.loginMethod == "proxy") {
    let apiPath = getApiPath("api/auth/login")
    const res = await fetch(apiPath, {
      method: "POST",
      credentials: 'same-origin', // Ensure cookies are sent and can be set
    });
    const body = await res.text();
    if (res.status !== 200) {
      throw new Error(body);
    }
  }
  return
}

export async function renew() {
  // Cookie-based renewal - no JWT parameter needed
  // Backend reads cookie, validates, and sets new cookie
  let apiPath = getApiPath("api/auth/renew")
  const res = await fetch(apiPath, {
    method: "POST",
    credentials: 'same-origin', // Cookie is sent automatically, backend renews it
  });
  const body = await res.text();
  if (res.status === 200) {
    mutations.setSession(generateRandomCode(8));
    // Backend sets the new cookie, no state management needed
  } else {
    throw new Error(body);
  }
}

export function generateRandomCode(length) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    code += charset[randomIndex];
  }

  return code;
}

export async function logout() {
  try {
    const res = await fetch(getApiPath("api/auth/logout"), {
      method: "POST",
      credentials: 'same-origin'
    });
    if (res.ok) {
      const data = await res.json();
      let logoutUrl = data.logoutUrl;
      // Backend clears the cookie, but frontend does it as fail-safe cleanup
      document.cookie = "filebrowser_quantum_jwt=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/";
      mutations.setCurrentUser(null);
      // No need to clear state.jwt - cookie is the source of truth
      if (!logoutUrl) {
        logoutUrl = globalVars.baseURL+"login";
      }
      // The Drive session is already over at this point: the server deleted the cookie above
      // and the fail-safe deletion has run. What is left is where to leave the person, and
      // that depends on how they got here.
      //
      // If the Joliro hub opened this tab, closing it puts them back on the hub, still signed
      // in, one click from opening Drive again. Leaving them on a login screen in a second tab
      // while a signed-in hub sits in the first is the thing that reads as "you are locked
      // out" when they are not.
      //
      // If they opened Drive themselves -- typed the address, or came from a bookmark -- there
      // is no hub tab to go back to, and closing would leave them with nothing. They get
      // today's behaviour: the B2C sign-out below, ending with the login screen.
      //
      // We do not need to be told which case this is. window.close() is only permitted on a
      // tab a script opened, so the browser already knows and already draws the line in the
      // right place. Tested in Chromium, headless and headed, including across the full B2C
      // round trip (hub -> Drive -> B2C -> back to Drive): a hub-opened tab still closes, and
      // a person-opened tab refuses silently and falls through to the redirect below. A
      // browser that refuses where Chromium allows costs nothing -- it just gets today's
      // behaviour.
      //
      // The refusal is silent, so the fallback has to be the timer rather than a catch.
      try {
        window.close();
      } catch (e) {
        // Some browsers throw rather than warn. Either way the redirect below covers it.
      }
      // Long enough for a permitted close to take the tab down before this fires, short enough
      // that a refused close is not a visible pause. Also still covers the original reason for
      // the delay: letting the cookie deletion settle before we navigate.
      setTimeout(() => {
        window.location.href = logoutUrl;
      }, 250);
      return; // Stop execution
    } else {
      // Handle potential errors from the API, e.g., res.status 401, 500
      console.error("Logout API call failed:", res.status, res.statusText);
    }
  } catch (e) {
    console.error("An error occurred during logout:", e);
  }
}

// Helper function to retrieve the value of a specific cookie
//function getCookie(name) {
//  return document.cookie
//    .split('; ')
//    .find(row => row.startsWith(name + '='))
//    ?.split('=')[1];
//}

export async function initAuth() {
  if (!getters.isShare()) {
    console.log("validating login");
    await validateLogin();
  }
  if (globalVars.recaptcha) {
      await new Promise((resolve) => {
          const check = () => {
              if (typeof window.grecaptcha === "undefined") {
                  setTimeout(check, 100);
              } else {
                  resolve();
              }
          };
          check();
      });
  }
}