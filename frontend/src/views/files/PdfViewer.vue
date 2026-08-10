<template>
  <div class="pdf-viewer" ref="scroller">
    <div v-if="loading" class="pdf-status">
      {{ $t("general.loading", { suffix: "..." }) }}
    </div>
    <div v-else-if="error" class="pdf-status pdf-error">{{ error }}</div>
    <div v-show="!loading && !error" class="pdf-pages" ref="pages"></div>
  </div>
</template>

<script>
// Renders a PDF inside Drive rather than handing it to the browser.
//
// This replaced an <iframe> pointed at /api/raw, which failed twice over. Every Drive
// response carries X-Frame-Options: DENY, which blocks framing even same-origin, so the
// frame showed the browser's "refused to connect" page. And where the frame did load, a
// browser configured with "Download PDFs" instead of "Open PDFs" downloaded the file
// rather than displaying it -- silently, with nothing on screen to say so.
//
// That second failure is the one that matters. It meant the residue behaviour of this
// product was decided by a preference we cannot see, cannot control, and which differs on
// every machine a survivor might use. Someone who believed they had only looked at a
// document had in fact left a copy in the Downloads folder of a computer that may not be
// theirs, and nothing told them.
//
// Fetching the bytes and drawing them to a canvas removes the dependency entirely. There
// is no navigation for a download preference to act on, no frame for a header to block,
// and the file never touches the disk unless the person asks for it with the Download
// button. Behaviour is now the same on every device.
//
// pdfjs is loaded with a dynamic import so it becomes its own chunk: nobody who never
// opens a PDF pays for it, which matters on a slow or metered connection.
export default {
  name: "PdfViewer",
  props: {
    raw: { type: String, required: true },
  },
  data() {
    return {
      loading: true,
      error: "",
      doc: null,
    };
  },
  watch: {
    raw: {
      handler() {
        this.load();
      },
      immediate: true,
    },
  },
  beforeUnmount() {
    this.destroyDoc();
  },
  methods: {
    destroyDoc() {
      if (this.doc) {
        try {
          this.doc.destroy();
        } catch {
          // Nothing useful to do; the page is going away regardless.
        }
        this.doc = null;
      }
    },
    async load() {
      this.destroyDoc();
      this.loading = true;
      this.error = "";
      try {
        const pdfjs = await import("pdfjs-dist");
        // Same-origin worker, bundled by Vite. The baseline CSP allows script-src 'self',
        // and worker-src falls back to it, so no policy change is needed.
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        // Fetched as data, deliberately. A navigation here is what let the browser's
        // download preference take over.
        const res = await fetch(this.raw, { credentials: "same-origin" });
        if (!res.ok) {
          throw new Error(`${res.status}`);
        }
        const bytes = new Uint8Array(await res.arrayBuffer());

        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        this.doc = doc;
        this.loading = false;
        await this.$nextTick();
        await this.renderAll(doc);
      } catch (e) {
        // A PDF that will not render must say so. Failing to a blank screen is how this
        // looked like the application was broken in the first place.
        this.error = this.$t("files.noPreview");
        this.loading = false;
        console.error("PdfViewer:", e);
      }
    },
    async renderAll(doc) {
      const host = this.$refs.pages;
      if (!host) return;
      host.innerHTML = "";
      // Cap the device pixel ratio: on a high-DPI phone an uncapped ratio makes canvases
      // large enough to exhaust memory on a long document.
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      for (let n = 1; n <= doc.numPages; n++) {
        if (this.doc !== doc) return; // navigated away mid-render
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.className = "pdf-page";
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = "100%";
        canvas.setAttribute("aria-label", `Page ${n} of ${doc.numPages}`);
        host.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        ctx.scale(ratio, ratio);
        await page.render({ canvasContext: ctx, viewport }).promise;
      }
    },
  },
};
</script>

<style scoped>
.pdf-viewer {
  width: 100%;
  height: 100%;
  overflow: auto;
}

.pdf-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1em;
  padding: 1em;
}

.pdf-pages :deep(.pdf-page) {
  max-width: 60em;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  background: #fff;
}

.pdf-status {
  padding: 2em;
  text-align: center;
}

.pdf-error {
  color: var(--red, #e53935);
}
</style>
