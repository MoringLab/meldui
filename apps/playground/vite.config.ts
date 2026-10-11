import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/reservations-api": {
        target: "http://127.0.0.1:8788",
        rewrite: (path) => path.replace(/^\/reservations-api/, ""),
      },
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        studio: resolve(__dirname, "studio.html"),
        service: resolve(__dirname, "service.html"),
        eval: resolve(__dirname, "eval.html"),
        reservation: resolve(__dirname, "reservation.html"),
        showcase: resolve(__dirname, "showcase.html"),
      },
    },
  },
});
