import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Keep the vendor libraries in their own chunk so app edits do not
        // invalidate the whole bundle for returning users.
        manualChunks: {
          react: ['react', 'react-dom'],
          sheets: ['xlsx'],
          markdown: ['react-markdown'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
})
