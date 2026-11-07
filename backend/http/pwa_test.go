package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// The joliro PWA kit's files must be reachable at the site root without sign-in, with the
// right types. A service worker served as text/plain, or from anywhere but /sw.js, does not
// install; a manifest with the wrong type is ignored; and if any of it needs a session, the
// installed app cannot start signed out.

func withPwaFs(t *testing.T) {
	t.Helper()
	old := assetFs
	assetFs = fstest.MapFS{
		"sw.js.gz":                       {Data: []byte("gz-sw")},
		"manifest.webmanifest":           {Data: []byte(`{"name":"joliroDrive"}`)},
		"pwa/discreet.webmanifest":       {Data: []byte(`{"name":"Storage"}`)},
		"pwa/start.html":                 {Data: []byte("<!doctype html>")},
		"pwa/offline.html":               {Data: []byte("<!doctype html>")},
		"pwa/joliro-pwa.js":              {Data: []byte("js")},
		"pwa/joliro-pwa.css":             {Data: []byte("css")},
		"pwa/icons/icon-192.png":         {Data: []byte("png")},
		"public/index.html":              {Data: []byte("not served here")},
		"config.generated.yaml":          {Data: []byte("secret: no")},
		"img/icons/android-chrome-x.png": {Data: []byte("png")},
	}
	t.Cleanup(func() { assetFs = old })
}

func pwaGet(path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	pwaHandler(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w
}

func TestPwaServesKitFilesAtTheRoot(t *testing.T) {
	withPwaFs(t)
	cases := map[string]string{
		"/manifest.webmanifest":     "application/manifest+json",
		"/pwa/discreet.webmanifest": "application/manifest+json",
		"/pwa/joliro-pwa.js":        "application/javascript; charset=utf-8",
		"/pwa/joliro-pwa.css":       "text/css; charset=utf-8",
		"/pwa/icons/icon-192.png":   "image/png",
		"/pwa/start.html":           "text/html; charset=utf-8",
		"/pwa/offline.html":         "text/html; charset=utf-8",
	}
	for path, want := range cases {
		w := pwaGet(path)
		if w.Code != http.StatusOK {
			t.Errorf("%s: status %d", path, w.Code)
			continue
		}
		if got := w.Header().Get("Content-Type"); got != want {
			t.Errorf("%s: Content-Type = %q, want %q", path, got, want)
		}
	}
}

func TestPwaServiceWorkerHeaders(t *testing.T) {
	withPwaFs(t)
	w := pwaGet("/sw.js")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	h := w.Header()
	if got := h.Get("Content-Type"); got != "application/javascript; charset=utf-8" {
		t.Errorf("Content-Type = %q", got)
	}
	if got := h.Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache so a new worker is picked up", got)
	}
	// Vite gzips .js in production builds; the original is deleted.
	if got := h.Get("Content-Encoding"); got != "gzip" {
		t.Errorf("Content-Encoding = %q, want gzip for the .gz-only build output", got)
	}
	// The worker calls the hub's push API when its subscription rotates.
	if csp := h.Get("Content-Security-Policy"); !strings.Contains(csp, "connect-src 'self' https://www.joliro.org") {
		t.Errorf("worker CSP does not allow the hub: %q", csp)
	}
}

func TestPwaPagesAreNotIndexed(t *testing.T) {
	withPwaFs(t)
	for _, path := range []string{"/pwa/start.html", "/pwa/offline.html"} {
		w := pwaGet(path)
		if got := w.Header().Get("X-Robots-Tag"); !strings.Contains(got, "noindex") {
			t.Errorf("%s: X-Robots-Tag = %q", path, got)
		}
		csp := w.Header().Get("Content-Security-Policy")
		for _, want := range []string{"style-src 'self'", "script-src 'self'", "https://www.joliro.org", "frame-ancestors 'none'"} {
			if !strings.Contains(csp, want) {
				t.Errorf("%s: CSP %q lacks %q", path, csp, want)
			}
		}
		if strings.Contains(csp, "unsafe-inline") {
			t.Errorf("%s: CSP allows inline code; the kit needs none", path)
		}
	}
}

// Only the kit's own files. Nothing else in the build output may be reachable through these
// routes, whatever the path looks like.
func TestPwaServesNothingElse(t *testing.T) {
	withPwaFs(t)
	for _, path := range []string{
		"/pwa/../config.generated.yaml",
		"/pwa/../public/index.html",
		"/pwa/%2e%2e/config.generated.yaml",
		"/pwa/",
		"/pwa/missing.js",
		"/config.generated.yaml",
		"/img/icons/android-chrome-x.png",
		"/site.webmanifest",
	} {
		if w := pwaGet(path); w.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", path, w.Code)
		}
	}
}

func TestIndexCSPAllowsTheKit(t *testing.T) {
	csp := indexCSP("abc")
	for _, want := range []string{
		"manifest-src 'self'",
		"worker-src 'self'",
		"connect-src 'self' https://www.joliro.org",
		"script-src 'self' 'nonce-abc'",
	} {
		if !strings.Contains(csp, want) {
			t.Errorf("index CSP %q lacks %q", csp, want)
		}
	}
	if strings.Contains(csp, "manifest-src 'self' blob:") {
		t.Errorf("index CSP still allows the old blob: manifest")
	}
}
