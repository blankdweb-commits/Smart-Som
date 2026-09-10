import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  css: {
    // Emit ONE consolidated stylesheet instead of separate per-chunk vendor/css
    // files. The only external CSS was react-calendar's (~2.75 kB) imported by
    // ExamTimetable; merging it removes a second render-blocking request and
    // any duplication between index-*.css and vendor-*.css. File names keep
    // Vite's content hash, so unchanged CSS keeps the same URL (no churn on
    // redeploy) and changed CSS gets a fresh cache-busting hash.
    codeSplit: false,
    minify: 'esbuild',
  },
  server: {
    proxy: {
      // Proxy Paystack backend calls to the local serverless functions so
      // /api/verify-payment works during local development, not just on Vercel.
      "/api": {
        target: process.env.API_TARGET || "http://localhost:3001",
        changeOrigin: true
      }
    }
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: true
  },
  build: {
    // Production bundles must stay lean for Vercel upload/deploy. Source maps
    // for the huge bundled question banks are not served in production (the
    // deployed JS is public regardless), and they added ~7 MB of upload
    // payload per deploy. Dev/type errors are still reported against source
    // via Vite's own sourcemaps during `vite dev`.
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('pdfjs-dist') || id.includes('tesseract.js') || id.includes('mammoth')) return 'vendor-parsing';
            return 'vendor';
          }
          // Only the raw bank JSON lands in `flashcard-data`. loadFlashcards.js
          // MUST stay in the default/entry chunk: AppContext imports it in the
          // main graph, so grouping it here would drag the whole lazy bank chunk
          // (≈16 MB) back onto the initial page load. Its glob uses dynamic
          // import()s, so the JSON chunk is fetched on demand (after auth) and
          // never by anonymous visitors.
          if (id.includes('src/data/flashcards/')) {
            return 'flashcard-data';
          }
        }
      }
    },
    chunkSizeWarningLimit: 1000
  }
});
