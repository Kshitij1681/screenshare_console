import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const SIGNALING_PORT = process.env.SIGNALING_PORT ?? 9000;

// Proxying /ws means the client can always talk to its own origin, so the same
// build works behind the dev server and behind the Node server in production.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: `ws://localhost:${SIGNALING_PORT}`, ws: true },
      "/healthz": { target: `http://localhost:${SIGNALING_PORT}` },
    },
  },
});
