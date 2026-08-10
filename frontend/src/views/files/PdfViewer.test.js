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

describe("nextRenderSeq", () => {
  // Vue sets up immediate watchers before the created hook, so the first call happens with
  // renderSeq still undefined. ++undefined is NaN, and NaN !== NaN, so the render guard
  // rejected its own render on page one and drew nothing at all.
  it("starts at 1 even when nothing has initialised it", () => {
    const ctx = {};
    expect(PdfViewer.methods.nextRenderSeq.call(ctx)).toBe(1);
    expect(Number.isNaN(ctx.renderSeq)).toBe(false);
  });

  it("increases, so an older render can tell it has been superseded", () => {
    const ctx = {};
    const first = PdfViewer.methods.nextRenderSeq.call(ctx);
    const second = PdfViewer.methods.nextRenderSeq.call(ctx);
    expect(second).toBe(first + 1);
    expect(first).not.toBe(ctx.renderSeq);
  });

  it("returns a value that compares equal to itself", () => {
    // The whole point: whatever this returns must satisfy `seq === this.renderSeq` for the
    // current render. NaN does not, which is how a blank viewer happened twice.
    const ctx = {};
    const seq = PdfViewer.methods.nextRenderSeq.call(ctx);
    expect(seq === ctx.renderSeq).toBe(true);
  });
});

describe("the pinned pdfjs version", () => {
  // pdfjs 6.2.108 was installed first and could never have worked. It calls
  // Map.prototype.getOrInsertComputed, a proposal-stage method absent from shipping
  // browsers -- Chromium 141 does not have it -- so every render threw an internal error
  // regardless of the arguments passed. Proven with the real library in real Chromium, not
  // inferred.
  //
  // The 4.x line renders correctly, and takes canvasContext. The 5+ line replaced that with
  // a canvas parameter, so version and call signature have to move together. A careless
  // major bump breaks rendering silently, which is exactly how this feature burned five
  // deploys, so the pin is asserted here rather than trusted to a comment.
  it("stays on the 4.x line, which shipping browsers can actually run", async () => {
    const pkg = await import("../../../package.json");
    const range = (pkg.default || pkg).dependencies["pdfjs-dist"];
    expect(range).toMatch(/^\^?4\./);
  });
});
