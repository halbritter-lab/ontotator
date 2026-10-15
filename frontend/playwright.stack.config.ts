import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-stack",
  workers: 1,
  use: { baseURL: process.env.STACK_BASE_URL ?? "http://127.0.0.1:8000" },
});
