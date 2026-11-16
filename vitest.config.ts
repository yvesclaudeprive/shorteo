import { defineConfig } from "vitest/config";
import pkg from "./package.json";

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
