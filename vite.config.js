import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    host: "0.0.0.0",
    allowedHosts: true
  },
  build: {
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
