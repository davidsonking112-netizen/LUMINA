import { defineConfig, devices } from '@playwright/test'

const webPort = 15174
const apiPort = 18787
const appUrl = `http://127.0.0.1:${webPort}`
const apiUrl = `http://127.0.0.1:${apiPort}`
const hostileOrigin = `http://localhost:${webPort + 1}`
const browserTestDatabase = `/tmp/forge-e2e-${process.pid}.sqlite`

process.env.CSRF_APP_URL = appUrl
process.env.CSRF_API_URL = apiUrl
process.env.CSRF_HOSTILE_ORIGIN = hostileOrigin

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: appUrl,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] },
  },
  webServer: {
    command: 'npm run dev',
    url: appUrl,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      FORGE_DB_PATH: browserTestDatabase,
      PORT: String(apiPort),
      VITE_PORT: String(webPort),
      VITE_STRICT_PORT: 'true',
      FORGE_ALLOWED_ORIGINS: appUrl,
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
