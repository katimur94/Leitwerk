import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Web-Push (Etappe 2): push-/notificationclick-Handler liegen in
      // public/push-sw.js und werden in den generierten Service Worker geladen.
      workbox: { importScripts: ["push-sw.js"] },
      manifest: {
        name: "Leitwerk",
        short_name: "Leitwerk",
        description: "Das Leitwerk für dein Büro.",
        lang: "de",
        display: "standalone",
        theme_color: "#1E2A4A",
        background_color: "#FAFAF8",
        icons: [
          {
            src: "/logo.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
    }),
  ],
  server: { port: 5173 },
});
