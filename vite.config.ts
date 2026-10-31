import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const hmrClientPort = process.env.VITE_HMR_CLIENT_PORT
  ? Number(process.env.VITE_HMR_CLIENT_PORT)
  : undefined;

// https://vite.dev/config/
export default defineConfig({
  // Set by the platform's publish-to-production step (`VITE_BASE_PATH=/apps/<id>/`) so the built
  // index.html references its assets at the path the app is actually served from, instead of the
  // domain root. Unset during normal dev/preview, where the app is served from the domain root.
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: true,
    watch: {
      ignored: ["**/.opencode-data/**"],
    },
    hmr: {
      protocol: process.env.VITE_HMR_PROTOCOL === "wss" ? "wss" : "ws",
      host: process.env.VITE_HMR_HOST,
      clientPort: Number.isFinite(hmrClientPort) ? hmrClientPort : undefined,
      path: process.env.VITE_HMR_PATH,
    },
  },
  resolve: {
    alias: {
      "@": `${import.meta.dirname}/src`,
    },
  },
});
