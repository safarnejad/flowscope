// Browser end-to-end tests (e2e/*.e2e.ts): `bun run e2e`. They start their own server against a fixture tree in a
// temp folder, so they never read the real ~/.claude. Named *.e2e.ts so `bun test` leaves them alone.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.e2e\.ts$/,
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1400, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
    colorScheme: "light",
  },
});
