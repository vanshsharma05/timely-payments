import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // React in its own chunk so app edits do not invalidate it for
        // returning users; SheetJS in its own so the on-demand import stays a
        // single file. react-markdown is left to the splitter: naming it a
        // chunk pulled a shared helper into it, so every other chunk — and the
        // first load — imported the 126 kB renderer nobody had opened.
        manualChunks(id) {
          if (id.includes('node_modules/xlsx')) return 'sheets';
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
})
