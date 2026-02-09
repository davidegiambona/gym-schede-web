import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",

      // Manifest direttamente qui (più semplice e senza conflitti)
      manifest: {
        name: "Gym Schede",
        short_name: "GymSchede",
        description: "Calendario interno e schede settimanali sincronizzate su cloud.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#050812",
        theme_color: "#0b1220",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },

      includeAssets: [
        "apple-touch-icon.png",
        "pwa-192.png",
        "pwa-512.png",
        "pwa-512-maskable.png"
      ],

      workbox: {
        // Lasciamo i default + fallback per SPA
        navigateFallback: "/index.html"
      },

      // IMPORTANTISSIMO: disattivata in dev per evitare warning "dev-dist"
      devOptions: {
        enabled: false
      }
    })
  ]
});
