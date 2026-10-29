import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The dev server may read the bundled handbook (src/help/handbook.ts) outside the frontend root.
  server: { fs: { allow: [".", "../docs/handbook"] } },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}", "tests/e2e/**/*.spec.tsx"],
  },
});
