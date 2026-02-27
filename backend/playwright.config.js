const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: "http://127.0.0.1:4173"
  },
  webServer: {
    command: "node e2e/serve-frontend.js",
    port: 4173,
    reuseExistingServer: true,
    timeout: 30_000
  }
});
