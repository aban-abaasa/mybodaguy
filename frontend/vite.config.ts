import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "convex/react": path.resolve(__dirname, "./src/shims/convex-react.ts"),
      "convex/server": path.resolve(__dirname, "./src/shims/convex-server.ts"),
    },
  },
  // jsPDF and qrcode are only imported on demand (air ticket download); listing it here
  // pre-bundles it at startup so Vite doesn't re-optimize mid-session and
  // leave open tabs with a stale "Outdated Optimize Dep" hash.
  optimizeDeps: {
    include: ["jspdf", "qrcode"],
  },
  server: {
    port: 5177,
    proxy: {
      // If you need to proxy API calls to a backend, add them here
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
});
