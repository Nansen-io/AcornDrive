package http

import (
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/gtsteffaniak/go-logger/logger"
)

// joliro PWA kit v1.
//
// The kit's files (generated into frontend/public by _kit/build_pwa_assets.py, copied by Vite to
// the root of the build output) must resolve at the SITE root, whatever server.baseURL is:
//
//	/sw.js                  the one service worker; served from / so its scope is /
//	/manifest.webmanifest   the one standard manifest
//	/pwa/**                 client script/style, icons, discreet manifest, start and offline pages
//
// They carry no user data, so they are served without any auth middleware, without locale
// handling and without the baseURL redirect. Nothing else is served from here: the handler
// only reads those exact names, or files under pwa/, from the embedded frontend.

const pwaHub = "https://www.joliro.org"

// pwaPageCSP is for /pwa/start.html and /pwa/offline.html. The kit uses no inline script or
// style; connect-src names the hub for the push API.
const pwaPageCSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
	"connect-src 'self' " + pwaHub + "; manifest-src 'self'; worker-src 'self'; " +
	"frame-ancestors 'none'; base-uri 'self'; form-action 'none'; object-src 'none'"

// pwaWorkerCSP applies to fetches made by the service worker itself (a worker's CSP comes from
// its own script response): same-origin shell requests, and the hub's push API when the push
// subscription rotates.
const pwaWorkerCSP = "default-src 'self'; connect-src 'self' " + pwaHub

// pwaAssetPath maps a request path to a file in the frontend build, or "" if it is not one of
// the kit's files.
func pwaAssetPath(urlPath string) string {
	switch urlPath {
	case "/sw.js":
		return "sw.js"
	case "/manifest.webmanifest":
		return "manifest.webmanifest"
	}
	if !strings.HasPrefix(urlPath, "/pwa/") {
		return ""
	}
	p := strings.TrimPrefix(path.Clean(urlPath), "/")
	if !strings.HasPrefix(p, "pwa/") || !fs.ValidPath(p) {
		return ""
	}
	return p
}

func pwaHandler(w http.ResponseWriter, r *http.Request) {
	assetPath := pwaAssetPath(r.URL.Path)
	if assetPath == "" {
		http.NotFound(w, r)
		return
	}

	// Vite's compression plugin replaces .js files with .js.gz in production builds; the
	// static handler serves those the same way.
	contents, err := fs.ReadFile(assetFs, assetPath)
	gzipped := false
	if err != nil && strings.HasSuffix(assetPath, ".js") {
		contents, err = fs.ReadFile(assetFs, assetPath+".gz")
		gzipped = err == nil
	}
	if err != nil {
		http.NotFound(w, r)
		return
	}

	h := w.Header()
	switch {
	case assetPath == "sw.js":
		// Always revalidated, so a new worker is picked up on the next visit.
		h.Set("Cache-Control", "no-cache")
		h.Set("Content-Security-Policy", pwaWorkerCSP)
	case strings.HasSuffix(assetPath, ".png"):
		h.Set("Cache-Control", "public, max-age=86400")
	default:
		// Manifests, pages, the kit's script and style: not hashed, so revalidate (cheap, and
		// the service worker serves them from its shell cache anyway).
		h.Set("Cache-Control", "no-cache")
	}
	if strings.HasSuffix(assetPath, ".html") {
		h.Set("Content-Type", "text/html; charset=utf-8")
		h.Set("Content-Security-Policy", pwaPageCSP)
		// start.html and offline.html also carry <meta name="robots" content="noindex">.
		h.Set("X-Robots-Tag", "noindex, nofollow")
	} else {
		setContentType(w, assetPath)
	}
	if gzipped {
		h.Set("Content-Encoding", "gzip")
	}
	if _, err := w.Write(contents); err != nil {
		logger.Debugf("pwa: could not write %s: %v", assetPath, err)
	}
}
