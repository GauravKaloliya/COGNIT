import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    base: "/",
    server: {
      fs: {
        allow: [path.resolve(process.cwd(), "..")]
      },
      proxy: {
        "/api": {
          target: env.VITE_DEV_PROXY_TARGET || "http://localhost:5000",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, "")
        },
        "/static": {
          target: env.VITE_DEV_PROXY_TARGET || "http://localhost:5000",
          changeOrigin: true
        },
        "/shared": {
          target: env.VITE_DEV_PROXY_TARGET || "http://localhost:5000",
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: "dist",
      sourcemap: true,
      // Temporary debug build: disable minification in production to get usable stacks.
      minify: mode === "production" ? false : "terser",
      cssMinify: mode === "production" ? false : true,
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
  };
});
