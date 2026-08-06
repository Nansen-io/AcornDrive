package http

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// The single-logout endpoint has two jobs, and both of them are invisible in normal use:
// it deletes this app's cookie, and it returns a page that tells already-open Drive tabs
// the session is over. Every part of it fails silently. A stray X-Frame-Options header,
// a frame-ancestors list that has drifted away from the hub's hostname, or a CSP that
// blocks the announcement script all produce the same symptom -- a sign-out that looks
// complete while the mailbox, or here the file listing, stays open on screen. That is the
// failure this test exists to catch, because a person cannot see it happening.
//
// The handler is exercised through the same wrappers production uses, including
// securityHeadersMiddleware, because the header conflict is between those two layers and
// testing the handler alone would prove nothing.
func serveSLO(t *testing.T) *httptest.ResponseRecorder {
	t.Helper()
	setupTestEnv(t)

	handler := securityHeadersMiddleware(http.HandlerFunc(withoutUser(sloHandler)))
	req := httptest.NewRequest(http.MethodGet, "https://drive.joliro.org/api/auth/slo", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "drive.joliro.org")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestSLOClearsTheCookie(t *testing.T) {
	rec := serveSLO(t)

	var deletions int
	for _, c := range rec.Result().Cookies() {
		if c.Name == "filebrowser_quantum_jwt" && c.Value == "" && c.MaxAge < 0 {
			deletions++
		}
	}
	// Two login paths set this cookie with different Path/Domain, and a deletion only
	// matches on Name+Path+Domain, so one deletion would leave the other cookie alive.
	if deletions != 2 {
		t.Fatalf("expected 2 cookie deletions, got %d", deletions)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
}

func TestSLOCanBeFramedByTheHub(t *testing.T) {
	rec := serveSLO(t)

	// securityHeadersMiddleware sets X-Frame-Options: DENY on every response. DENY blocks
	// framing even same-origin, so leaving it here would make the browser refuse the hub's
	// hidden iframe before any cookie logic ran.
	if got, ok := rec.Header()["X-Frame-Options"]; ok {
		t.Errorf("X-Frame-Options is still set to %v; the hub's iframe will be refused", got)
	}

	csp := rec.Header().Get("Content-Security-Policy")
	if strings.Contains(csp, "frame-ancestors 'none'") {
		t.Fatalf("baseline frame-ancestors 'none' survived: %q", csp)
	}
	for _, origin := range sloFrameAncestors {
		if !strings.Contains(csp, origin) {
			t.Errorf("frame-ancestors is missing %s: %q", origin, csp)
		}
	}
}

func TestSLOAnnouncesTheSignOut(t *testing.T) {
	rec := serveSLO(t)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("Content-Type = %q, want text/html", ct)
	}

	body := rec.Body.String()
	if !strings.Contains(body, `new BroadcastChannel("joliro-slo")`) {
		t.Fatal("the page does not open the joliro-slo channel; open tabs will never hear the sign-out")
	}
	if !strings.Contains(body, `"signed-out"`) {
		t.Fatal("the page does not post a signed-out message")
	}
	// The page must not offer a way back in. A sign-out that lands on a login form is the
	// defect this whole mechanism exists to remove.
	if strings.Contains(strings.ToLower(body), "password") || strings.Contains(strings.ToLower(body), "<form") {
		t.Error("the signed-out page appears to contain a login form")
	}
}

func TestSLONonceMatchesTheScript(t *testing.T) {
	rec := serveSLO(t)

	csp := rec.Header().Get("Content-Security-Policy")
	cspNonce := regexp.MustCompile(`script-src 'nonce-([^']+)'`).FindStringSubmatch(csp)
	if cspNonce == nil {
		t.Fatalf("no script-src nonce in the policy: %q", csp)
	}
	tagNonce := regexp.MustCompile(`<script nonce="([^"]+)"`).FindStringSubmatch(rec.Body.String())
	if tagNonce == nil {
		t.Fatal("the script tag carries no nonce")
	}
	// A mismatch means the browser silently refuses to run the script, and the tab stays
	// open with the file listing on it while everything else reports success.
	if cspNonce[1] != tagNonce[1] {
		t.Fatalf("nonce mismatch: policy has %q, script tag has %q", cspNonce[1], tagNonce[1])
	}
	if len(cspNonce[1]) < 16 {
		t.Errorf("nonce is only %d characters; it should be a fresh 128-bit random value", len(cspNonce[1]))
	}
}

func TestSLONonceIsPerResponse(t *testing.T) {
	first := serveSLO(t).Header().Get("Content-Security-Policy")
	second := serveSLO(t).Header().Get("Content-Security-Policy")
	if first == second {
		t.Fatal("two responses carried the same nonce; a reused nonce is no nonce at all")
	}
}
