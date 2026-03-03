import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: "/",
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  },
  build: {
    outDir: "dist",
    sourcemap: mode === "development",
    minify: "terser",
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          charts: ["chart.js", "react-chartjs-2"]
        }
      }
    }
  },
  preview: {
    port: 4173,
    host: true
  },
  esbuild: {
    drop: mode === "production" ? ["console", "debugger"] : []
  }
}));
