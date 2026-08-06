
package http

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	libError "errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	jwt "github.com/golang-jwt/jwt/v4"
	"github.com/golang-jwt/jwt/v4/request"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/time/rate"

	"github.com/gtsteffaniak/filebrowser/backend/auth"
	"github.com/gtsteffaniak/filebrowser/backend/chainfs"
	"github.com/gtsteffaniak/filebrowser/backend/common/errors"
	"github.com/gtsteffaniak/filebrowser/backend/common/settings"
	"github.com/gtsteffaniak/filebrowser/backend/common/utils"
	"github.com/gtsteffaniak/filebrowser/backend/database/share"
	"github.com/gtsteffaniak/filebrowser/backend/database/storage"
	"github.com/gtsteffaniak/filebrowser/backend/database/users"
	"github.com/gtsteffaniak/go-logger/logger"
)

// first checks for cookie
// then checks for header Authorization as Bearer token
// then checks for query parameter
func extractToken(r *http.Request) (string, error) {
	hasToken := false
	tokenObj, err := r.Cookie("filebrowser_quantum_jwt")
	if err == nil {
		hasToken = true
		token := tokenObj.Value
		// Checks if the token isn't empty and if it contains two dots.
		// The former prevents incompatibility with URLs that previously
		// used basic auth.
		if token != "" && strings.Count(token, ".") == 2 {
			return token, nil
		}
	}

	auth := r.URL.Query().Get("auth")
	if auth != "" {
		hasToken = true
		if strings.Count(auth, ".") == 2 {
			return auth, nil
		}
	}

	// Check for Authorization header
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" {
		hasToken = true
		// Split the header to get "Bearer {token}"
		parts := strings.Split(authHeader, " ")
		if len(parts) == 2 && parts[0] == "Bearer" {
			token := parts[1]
			return token, nil
		}
	}

	if hasToken {
		return "", fmt.Errorf("invalid token provided")
	}

	return "", request.ErrNoTokenInRequest
}

func setupProxyUser(r *http.Request, data *requestContext, proxyUser string) (*users.User, error) {
	var err error
	// Retrieve the user from the store and store it in the context
	data.user, err = store.Users.Get(proxyUser)
	if err != nil {
		if err.Error() != "the resource does not exist" {
			return nil, err
		}
		if config.Auth.Methods.ProxyAuth.CreateUser {
			user := users.User{
				LoginMethod: users.LoginMethodProxy,
				Username:    proxyUser,
			}
			settings.ApplyUserDefaults(&user)
			if user.Username == config.Auth.AdminUsername {
				user.Permissions.Admin = true
			}
			err = storage.CreateUser(user, user.Permissions)
			if err != nil {
				return nil, err
			}
			data.user, err = store.Users.Get(proxyUser)
			if err != nil {
				return nil, err
			}
		} else {
			return nil, fmt.Errorf("proxy authentication failed - no user found")
		}
	}
	if data.user.LoginMethod != users.LoginMethodProxy {
		return nil, errors.ErrWrongLoginMethod
	}
	if data.user.Username == config.Auth.AdminUsername && !data.user.Permissions.Admin {
		data.user.Permissions.Admin = true
		err = store.Users.Update(data.user, true, "Permissions")
		if err != nil {
			return nil, err
		}
	}
	return data.user, nil
}

// loginHandler handles user authentication via password.
// @Summary User login
// @Description Authenticate a user with a username and password. The password must be URL-encoded and sent in the X-Password header to support special characters (e.g., ^, %, £, €, etc.).
// @Tags Auth
// @Accept json
// @Produce json
// @Param username query string true "Username"
// @Param recaptcha query string false "ReCaptcha response token (if enabled)"
// @Param X-Password header string true "URL-encoded password"
// @Param X-Secret header string false "TOTP code (if 2FA is enabled)"
// @Success 200 {string} string "JWT token for authentication"
// @Failure 403 {object} map[string]string "Forbidden - authentication failed"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /api/auth/login [post]
func loginHandler(w http.ResponseWriter, r *http.Request, d *requestContext) (int, error) {
	if d.user.LoginMethod == users.LoginMethodProxy {
		return printToken(w, r, d.user)
	}
	passwordUser := d.user.LoginMethod == users.LoginMethodPassword
	enforcedOtp := config.Auth.Methods.PasswordAuth.EnforcedOtp
	missingOtp := d.user.TOTPSecret == ""
	if passwordUser && enforcedOtp && missingOtp {
		return http.StatusForbidden, errors.ErrNoTotpConfigured
	}
	return printToken(w, r, d.user) // Pass the data object
}

// sloFrameAncestors is the list of origins allowed to frame /api/auth/slo. The Joliro hub
// is the only caller today. The acorn.tools entries are kept through the rebrand because a
// person may still be on an older link, and dropping them would silently stop signing that
// person out -- the failure mode this endpoint exists to prevent. Kept as a literal rather
// than an environment variable so it is visible in review: a blank or stale variable here
// would produce a sign-out that looks complete while the tab stays open.
var sloFrameAncestors = []string{
	"https://www.joliro.org",
	"https://joliro.org",
	"https://www.acorn.tools",
	"https://acorn.tools",
}

// logoutHandler handles user logout
// @Summary User Logout
// @Description Returns a logout URL for the frontend to redirect to.
// @Tags Auth
// @Produce json
// @Param auth query string false "JWT token"
// @Success 200 {object} map[string]string "{"logoutUrl": "http://..."}"
// @Router /api/auth/logout [post]
// sloHandler ends this app's session for cross-app single-logout. The hub loads this
// endpoint in a hidden iframe when the person logs out, and no auth is required: the
// iframe will not carry a valid token, and the endpoint can only ever end the caller's
// own session, never start one. Two login paths set the cookie with different
// Path/Domain, so we emit a deletion for each (Name+Path+Domain identify a cookie for
// deletion).
//
// It also returns a small HTML page rather than 204. The page's only job is to announce
// on a same-origin BroadcastChannel that this app's session has ended. Drive tabs the
// person already has open are listening (frontend/src/utils/slo.ts) and close themselves
// when they hear it. This is how an open tab gets closed at all: the hub opens tiles with
// window.open(..., 'noopener'), which returns null, so the hub holds no reference to the
// tab and cannot close it directly. The iframe, however, is on this app's own origin --
// which is exactly what BroadcastChannel needs.
//
// Deleting the cookie is the security boundary. Closing the tab is the visible layer and
// must never be relied on: if the broadcast never arrives, or the browser refuses
// window.close(), the session is still over.
//
// Two response headers are deliberately relaxed for this one path. securityHeadersMiddleware
// sets X-Frame-Options: DENY and frame-ancestors 'none' on every response, which blocks
// framing even same-origin, so the hub's hidden iframe would be refused by the browser
// before any of this ran. We drop X-Frame-Options and set a frame-ancestors list naming
// the hub. Nothing is weakened by doing so: an attacker who frames this page can only
// sign their victim out.
func sloHandler(w http.ResponseWriter, r *http.Request, _ *requestContext) (int, error) {
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	cookieHost, _, err := net.SplitHostPort(host)
	if err != nil {
		cookieHost = host // no port present
	}
	secure := getScheme(r) == "https"

	// Password/proxy login sets Path=/, Domain=host, SameSite=Strict.
	http.SetCookie(w, &http.Cookie{
		Name:     "filebrowser_quantum_jwt",
		Value:    "",
		Domain:   cookieHost,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	})
	// ChainFS/Azure (acorn.tools) login sets Path=BaseURL, no Domain, SameSite=Lax.
	http.SetCookie(w, &http.Cookie{
		Name:     "filebrowser_quantum_jwt",
		Value:    "",
		Path:     config.Server.BaseURL,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	})

	w.Header().Set("Cache-Control", "no-store")

	// Baseline CSP has script-src 'self', so the announcement script needs a per-response
	// nonce. If the random read fails we fall back to the old 204: the cookies above are
	// already set, so the sign-out still happens; only the tab-closing courtesy is lost.
	nonceBytes := make([]byte, 16)
	if _, randErr := rand.Read(nonceBytes); randErr != nil {
		logger.Errorf("slo: could not generate a CSP nonce, returning 204 without the close signal: %v", randErr)
		return http.StatusNoContent, nil
	}
	nonce := base64.RawURLEncoding.EncodeToString(nonceBytes)

	w.Header().Del("X-Frame-Options")
	w.Header().Set("Content-Security-Policy",
		"default-src 'none'; script-src 'nonce-"+nonce+"'; base-uri 'none'; form-action 'none'; "+
			"frame-ancestors "+strings.Join(sloFrameAncestors, " "))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)

	// This page has two roles. Framed by the hub, it is invisible and only broadcasts. Loaded
	// as the tab itself -- which is what B2C does when it sends the browser back here after
	// Drive's own Logout -- it is the last thing the person sees, so it also closes the tab
	// and, if the browser refuses, says plainly what happened. Either way it is not a login
	// form and offers no way back in without a password.
	page := `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signed out</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.75rem;padding:2rem;text-align:center;background:#ffffff;color:#1f2933;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<h1 style="margin:0;font-size:1.25rem;font-weight:600">You have been signed out</h1>
<p style="margin:0;font-size:1rem;max-width:28rem;line-height:1.5">Joliro Drive is closed in this browser. You can close this tab.</p>
<script nonce="` + nonce + `">
(function () {
  try {
    var channel = new BroadcastChannel("joliro-slo");
    channel.postMessage({ type: "signed-out", app: "drive" });
    setTimeout(function () { channel.close(); }, 0);
  } catch (e) {
    // No BroadcastChannel, or it is blocked. The cookie is gone regardless.
  }
  // The broadcast above is never delivered to its own sender, so when this page IS the tab
  // it has to close itself. window.close() is only permitted on a tab a script opened, which
  // is how the hub opens tiles; a tab the person opened themselves refuses it silently and
  // they see the message above instead. Framed, this is a no-op.
  if (window.top === window.self) {
    try { window.close(); } catch (e) {}
  }
})();
</script>
</body>
</html>
`
	if _, writeErr := w.Write([]byte(page)); writeErr != nil {
		logger.Debugf("slo: could not write the close-signal page: %v", writeErr)
	}
	// 0 tells wrapHandler not to call WriteHeader again -- we have written the response.
	return 0, nil
}

// chainFsEndSessionUrl returns the Azure AD B2C end-session URL the browser must be sent to
// for a sign-out to actually happen, or "" when none is configured.
//
// The identity session is a cookie the browser holds on the B2C domain. Nothing this server
// does can reach it. The previous implementation fetched the logout endpoint server-side, in
// a goroutine, discarding the response — a request that carried none of the person's cookies
// and therefore ended nothing. Drive cleared its own cookie, the login screen reappeared, and
// one click on Login signed the person straight back in without a password.
//
// A sign-out that only looks like one is more dangerous than one that visibly fails. Someone
// closes a laptop on a shared, borrowed or monitored machine believing the account is shut,
// and makes decisions about their safety on that basis. The screen agreed with them and the
// session did not.
func chainFsEndSessionUrl(r *http.Request, host string) string {
	cfg := config.Auth.Methods.ChainFsAuth
	endpoint := cfg.LogoutUrl
	if endpoint == "" {
		derived, err := chainfs.GetLogoutUrl(cfg.ApiBaseUrl)
		if err != nil || derived == "" {
			return ""
		}
		endpoint = derived
	}

	parsed, err := url.Parse(endpoint)
	if err != nil {
		// Send the browser to the configured value as-is. It may land on a Microsoft page
		// instead of Drive's login screen, which is untidy, but the person ends up signed
		// out. This has to fail closed.
		return endpoint
	}

	// Return people to the login page of the hostname they were actually using, derived from
	// the request rather than pinned to one name — the same reasoning that leaves
	// server.externalUrl empty. drive.joliro.org and drive.acorn.tools each return to
	// themselves, so nobody is bounced onto a hostname they did not choose mid-rebrand.
	q := parsed.Query()
	q.Set("post_logout_redirect_uri", fmt.Sprintf("%s://%s%slogin", getScheme(r), host, config.Server.BaseURL))
	parsed.RawQuery = q.Encode()
	return parsed.String()
}

func logoutHandler(w http.ResponseWriter, r *http.Request, d *requestContext) (int, error) {
	defer auth.RevokeAPIKey(d.token)

	// Clear the authentication cookie by setting it to expire in the past
	// Get the correct domain for cookie - prefer X-Forwarded-Host from reverse proxy
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	cookieHost, _, err := net.SplitHostPort(host)
	if err != nil {
		cookieHost = host // no port present
	}
	cookie := &http.Cookie{
		Name:     "filebrowser_quantum_jwt",
		Value:    "",
		Domain:   cookieHost,
		Path:     "/",
		HttpOnly: true,
		Secure:   getScheme(r) == "https",
		SameSite: http.SameSiteStrictMode,
		Expires:  time.Unix(0, 0), // Expire immediately
		MaxAge:   -1,              // Delete cookie
	}
	http.SetCookie(w, cookie)

	logoutUrl := fmt.Sprintf("%vlogin", config.Server.BaseURL) // Default fallback
	switch {
	case d.user != nil && d.user.LoginMethod == users.LoginMethodProxy:
		if u := config.Auth.Methods.ProxyAuth.LogoutRedirectUrl; u != "" {
			logoutUrl = u
		}
	case d.user != nil && d.user.LoginMethod == users.LoginMethodOidc:
		if u := config.Auth.Methods.OidcAuth.LogoutRedirectUrl; u != "" {
			logoutUrl = u
		}
	case config.Auth.Methods.ChainFsAuth.Enabled:
		// Keyed on the method being enabled rather than on d.user's login method, because
		// this endpoint is reachable withOrWithoutUser: someone whose Drive cookie has
		// already expired arrives here with d.user == nil. That person is among the most
		// likely to be clicking Logout, and under the previous condition they got no
		// identity-provider sign-out at all.
		if u := chainFsEndSessionUrl(r, host); u != "" {
			logoutUrl = u
		}
	}
	response := map[string]string{
		"logoutUrl": logoutUrl,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	err = json.NewEncoder(w).Encode(response)
	if err != nil {
		return http.StatusInternalServerError, err
	}

	return http.StatusOK, nil
}

// signupHandler registers a new user account.
// @Summary User signup
// @Description Register a new user account with a username and password.
// @Tags Auth
// @Accept json
// @Produce json
// @Success 201 {string} string "User created successfully"
// @Failure 400 {object} map[string]string "Bad request - invalid input"
// @Failure 405 {object} map[string]string "Method not allowed - signup is disabled"
// @Failure 409 {object} map[string]string "Conflict - user already exists"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /api/auth/signup [post]
func signupHandler(w http.ResponseWriter, r *http.Request, d *requestContext) (int, error) {
	if !settings.Config.Auth.Methods.PasswordAuth.Signup {
		return http.StatusMethodNotAllowed, fmt.Errorf("signup is disabled")
	}

	// Get credentials — password from header (preferred) or query string (fallback)
	username := r.URL.Query().Get("username")
	password := r.Header.Get("X-Password")
	if password == "" {
		password = r.URL.Query().Get("password")
	} else {
		var err error
		password, err = url.QueryUnescape(password)
		if err != nil {
			return http.StatusBadRequest, fmt.Errorf("invalid password encoding")
		}
	}

	// Validate that we have both username and password
	if username == "" || password == "" {
		return http.StatusBadRequest, fmt.Errorf("username and password are required")
	}

	user := users.User{
		Username: username,
		NonAdminEditable: users.NonAdminEditable{
			Password: password,
		},
		LoginMethod: users.LoginMethodPassword,
	}
	err := storage.CreateUser(user, settings.ConvertPermissionsToUsers(settings.Config.UserDefaults.Permissions))
	if err != nil {
		// Log the real reason, but return a generic message so signup cannot be used to
		// enumerate which usernames/emails already exist.
		logger.Debugf("signup failed for %q: %v", username, err)
		return http.StatusBadRequest, fmt.Errorf("could not create account")
	}
	return 201, nil
}

// renewHandler refreshes the authentication token for a logged-in user.
// @Summary Renew authentication token
// @Description Refresh the authentication token for a logged-in user.
// @Tags Auth
// @Accept json
// @Produce json
// @Success 200 {string} string "New JWT token generated"
// @Failure 401 {object} map[string]string "Unauthorized - invalid token"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /api/renew [post]
func renewHandler(w http.ResponseWriter, r *http.Request, d *requestContext) (int, error) {
	// check if x-auth header is present and token is
	return printToken(w, r, d.user)
}

func printToken(w http.ResponseWriter, r *http.Request, user *users.User) (int, error) {
	expires := time.Hour * time.Duration(config.Auth.TokenExpirationHours)
	signed, err := makeSignedTokenAPI(user, "WEB_TOKEN_"+utils.InsecureRandomIdentifier(4), expires, user.Permissions, false)
	if err != nil {
		if strings.Contains(err.Error(), "key already exists with same name") {
			return http.StatusConflict, err
		}
		return 401, errors.ErrUnauthorized
	}

	// Add 30 minutes buffer so expired token doesn't get automatically deleted by the browser
	// This allows backend to identify expired sessions and provide better user feedback
	expiresTime := time.Now().Add(expires).Add(time.Minute * 30)

	// Set the authentication token as an HTTP cookie
	// Get the correct domain for cookie - prefer X-Forwarded-Host from reverse proxy
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	loginCookieHost, _, err := net.SplitHostPort(host)
	if err != nil {
		loginCookieHost = host // no port present
	}
	cookie := &http.Cookie{
		Name:     "filebrowser_quantum_jwt",
		Value:    signed.Key,
		Domain:   loginCookieHost,
		Path:     "/",
		HttpOnly: true,
		Secure:   getScheme(r) == "https",
		SameSite: http.SameSiteStrictMode,
		Expires:  expiresTime,
	}
	http.SetCookie(w, cookie)

	// Still return token in body for backward compatibility and state management
	w.Header().Set("Content-Type", "text/plain")
	if _, err := w.Write([]byte(signed.Key)); err != nil {
		return 401, errors.ErrUnauthorized
	}
	return 0, nil
}

func makeSignedTokenAPI(user *users.User, name string, duration time.Duration, perms users.Permissions, minimal bool) (users.AuthToken, error) {
	_, ok := user.ApiKeys[name]
	if ok {
		return users.AuthToken{}, fmt.Errorf("key already exists with same name %v ", name)
	}
	now := time.Now()
	expires := now.Add(duration)

	var tokenString string
	var err error

	if minimal {
		// Create minimal token with only JWT standard claims
		minimalClaim := users.MinimalAuthToken{
			RegisteredClaims: jwt.RegisteredClaims{
				IssuedAt:  jwt.NewNumericDate(now),
				ExpiresAt: jwt.NewNumericDate(expires),
				Issuer:    "FileBrowser Quantum",
			},
		}
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, minimalClaim)
		tokenString, err = token.SignedString([]byte(config.Auth.Key))
		if err != nil {
			return users.AuthToken{}, err
		}
	} else {
		// Create full token with permissions and user ID
		fullClaim := users.AuthToken{
			MinimalAuthToken: users.MinimalAuthToken{
				RegisteredClaims: jwt.RegisteredClaims{
					IssuedAt:  jwt.NewNumericDate(now),
					ExpiresAt: jwt.NewNumericDate(expires),
					Issuer:    "FileBrowser Quantum",
				},
			},
			Name:        name,
			Permissions: perms,
			BelongsTo:   user.ID,
		}
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, fullClaim)
		tokenString, err = token.SignedString([]byte(config.Auth.Key))
		if err != nil {
			return users.AuthToken{}, err
		}
	}

	// Create the AuthToken to store in database (always includes permissions and user ID)
	storedClaim := users.AuthToken{
		MinimalAuthToken: users.MinimalAuthToken{
			RegisteredClaims: jwt.RegisteredClaims{
				IssuedAt:  jwt.NewNumericDate(now),
				ExpiresAt: jwt.NewNumericDate(expires),
				Issuer:    "FileBrowser Quantum",
			},
		},
		Key:         tokenString,
		Name:        name,
		Permissions: perms,
		BelongsTo:   user.ID,
	}

	if strings.HasPrefix(name, "WEB_TOKEN") {
		// don't add to api tokens, its a short lived web token
		return storedClaim, nil
	}

	// Perform the user update
	err = store.Users.AddApiKey(user.ID, name, storedClaim)
	if err != nil {
		return storedClaim, err
	}
	return storedClaim, nil
}

func authenticateShareRequest(r *http.Request, l *share.Link) (int, error) {
	if l.PasswordHash == "" {
		return 200, nil
	}

	tokenParam := r.URL.Query().Get("token")
	if tokenParam != "" {
		// Verify the token signature if it's in the new signed format
		if strings.Contains(tokenParam, ".") {
			parts := strings.Split(tokenParam, ".")
			if len(parts) == 2 {
				payload := parts[0]
				signature := parts[1]

				// Verify HMAC signature
				mac := hmac.New(sha256.New, []byte(config.Auth.Key))
				mac.Write([]byte(payload))
				expectedSignature := base64.URLEncoding.EncodeToString(mac.Sum(nil))

				// Use constant-time comparison to prevent timing attacks
				if hmac.Equal([]byte(signature), []byte(expectedSignature)) {
					// Token signature is valid, now check if it matches stored token
					if subtle.ConstantTimeCompare([]byte(tokenParam), []byte(l.Token)) == 1 {
						return 200, nil
					}
				}
			}
		} else {
			// Legacy token format (plain base64) - constant-time comparison
			if subtle.ConstantTimeCompare([]byte(tokenParam), []byte(l.Token)) == 1 {
				return 200, nil
			}
		}
	}

	// Throttle password-guessing per share. This runs only on the password path (token-based
	// access has already returned above), so it covers both the public share routes and the
	// authenticated /api/raw path — including distributed brute force against one share — with
	// no effect on normal browsing.
	if !shareRateLimiter.getWithRate("share-pw:"+l.Token, rate.Every(time.Minute/30), 10).Allow() {
		return http.StatusTooManyRequests, errTooManyRequests
	}

	password := r.Header.Get("X-SHARE-PASSWORD")
	password, err := url.QueryUnescape(password)
	if err != nil {
		return http.StatusUnauthorized, err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(l.PasswordHash), []byte(password)); err != nil {
		if libError.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
			return http.StatusUnauthorized, nil
		}
		return 401, err
	}
	return 200, nil
}
