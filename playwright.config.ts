import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke tests (`npm run test:e2e`) against the production build (`npm run build` first).
 * Starts `next start` with a test password, or reuses a server already on the port. The server
 * uses .env.local, so it talks to the real Supabase project: the tests log out at the end and
 * stub the AI, so they leave nothing behind and spend no quota.
 */
const PORT = Number(process.env.E2E_PORT ?? 3000);
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "localtest";

export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/unlock`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { APP_PASSWORD: E2E_PASSWORD },
  },
});
