package http

import (
	"net/http/httptest"
	"testing"
)

// Static assets are served with a Content-Type derived from their extension, and a missing
// entry does not fail loudly -- the file is served as text/plain and the browser refuses it.
//
// That is not a cosmetic problem. A module script or a wasm module rejected on MIME grounds
// produces a feature that simply does not work, with nothing in the server logs to say why.
// It cost a deploy to find when the bundled PDF worker was served as text/plain, pdfjs fell
// back to a "fake worker", and the only symptom was a PDF that would not display.
func TestStaticContentTypes(t *testing.T) {
	cases := map[string]string{
		"/static/assets/index-abc123.js":           "application/javascript; charset=utf-8",
		"/static/assets/pdf.worker.min-abc123.mjs": "application/javascript; charset=utf-8",
		"/static/assets/openjpeg-abc123.wasm":      "application/wasm",
		"/static/assets/index-abc123.css":          "text/css; charset=utf-8",
		"/static/fonts/material-abc.woff2":         "font/woff2",
		"/static/assets/logo-abc.svg":              "image/svg+xml",
		"/static/manifest.webmanifest":             "application/manifest+json",
	}
	for path, want := range cases {
		w := httptest.NewRecorder()
		setContentType(w, path)
		if got := w.Header().Get("Content-Type"); got != want {
			t.Errorf("%s: Content-Type = %q, want %q", path, got, want)
		}
	}
}

// Uppercase extensions must resolve the same way. A file called REPORT.MJS served as
// text/plain fails exactly as the lowercase case did.
func TestStaticContentTypeIsCaseInsensitive(t *testing.T) {
	w := httptest.NewRecorder()
	setContentType(w, "/static/assets/WORKER.MJS")
	if got := w.Header().Get("Content-Type"); got != "application/javascript; charset=utf-8" {
		t.Errorf("uppercase .MJS: Content-Type = %q", got)
	}
}
