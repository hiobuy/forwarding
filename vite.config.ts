import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
