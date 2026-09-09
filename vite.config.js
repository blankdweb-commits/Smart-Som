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
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('pdfjs-dist') || id.includes('tesseract.js') || id.includes('mammoth')) return 'vendor-parsing';
            return 'vendor';
          }
          if (id.includes('src/data/flashcards') || id.includes('src/data/loadFlashcards.js')) {
            return 'flashcard-data';
          }
        }
      }
    },
    chunkSizeWarningLimit: 1000
  }
});
