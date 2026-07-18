/// <reference types="node" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies every backend path so the SPA can use relative
// URLs both in dev (Vite on :5173) and in prod (httpsrv serving dist/
// on :8081 behind nginx). One config, no env switching.
const PROXY_TARGET = process.env.SQREADER_BACKEND ?? "http://127.0.0.1:8080";
const proxyPath = {
  target: PROXY_TARGET,
  changeOrigin: true,
  ws: false,
  configure: (proxy: { on: (ev: string, cb: (...a: unknown[]) => void) => void }) => {
    proxy.on("proxyReq", () => {});
  },
};

export default defineConfig({
  // Relative base so the built SPA works whether mounted at `/`,
  // `/sqr/viewer-next/`, `/sqr1/viewer-next/`, or any nginx prefix.
  // All asset URLs become `./assets/...`, resolved against the
  // current document URL by the browser.
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    // No source maps in the committed prod build — contributors debug via the
    // dev server (npm run dev), which has them.
    sourcemap: false,
    assetsDir: "assets",
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api":     proxyPath,
      "/health":  proxyPath,
      "/icons":   proxyPath,
      "/sqmaps":  proxyPath,
    },
  },
});
