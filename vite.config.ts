import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

// Configuration Vite adaptée à Tauri : port fixe, pas d'écran effacé.
export default defineConfig({
  plugins: [react()],
  // numéro de version affiché dans l'application (le même que celui de l'installateur)
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
