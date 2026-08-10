import { describe, it, expect } from "vitest";
import PdfViewer from "@/views/files/PdfViewer.vue";

// What this is protecting.
//
// The pdfjs document was originally returned from data(), which made Vue wrap it in a
// reactive Proxy. The render loop then compared the stored document against the one it was
// rendering, to stop an older render continuing after a newer one had started. A proxy is
// never identical to the object it wraps, so that check fired on the first page of every
// render: the viewer produced no pages, threw no exception, showed no error, and left a
// blank screen. It took three deploys to find, because nothing failed loudly at any point.
//
// This cannot be caught by a build, and mounting the component would need a real canvas and
// a real PDF. What can be asserted cheaply is the shape of the mistake: heavy library
// objects must not live in reactive state, and identity checks must not be made against
// things Vue may have wrapped.

describe("PdfViewer", () => {
  it("keeps the pdfjs document out of reactive state", () => {
    const initial = PdfViewer.data();
    expect(Object.keys(initial)).not.toContain("doc");
  });

  it("only holds render status in data, nothing Vue would deep-proxy", () => {
    // Anything added here later gets wrapped in a Proxy. Strings and booleans are fine;
    // a document, a worker or a canvas is not.
    const initial = PdfViewer.data();
    for (const value of Object.values(initial)) {
      expect(["string", "boolean", "number"]).toContain(typeof value);
    }
  });
});
