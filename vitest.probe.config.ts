import { defineConfig } from "vitest/config";

// Live checks against the real book sources: `npm run probe`.
// Kept out of the normal test run because they need the network and depend on third parties.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.probe.ts"],
    testTimeout: 60_000,
  },
});
