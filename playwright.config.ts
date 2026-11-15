import { defineConfig, devices } from '@playwright/test'

const browserTestDatabase = `data/forge-e2e-${process.pid}.sqlite`

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { FORGE_DB_PATH: browserTestDatabase },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
