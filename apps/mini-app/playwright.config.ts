import { defineConfig, devices } from '@playwright/test';
import { configuredBrowserChannel } from '../../scripts/e2e_browser_channel.cjs';

/** Browser contract for the client-first web and Telegram app.
 *
 * The test build intentionally has no Privy app ID, RPC URL, or FxAeon API
 * URL. Tests therefore exercise routing, unavailable states, accessibility,
 * and the invariant that the static client never calls a backend.
 */
const PORT = Number(process.env.E2E_PORT ?? 4321);
const BASE_URL = `http://localhost:${PORT}`;
// CI builds the export once before starting Playwright. Local runs still
// rebuild by default so a changed source tree cannot silently exercise stale
// dist/ assets; callers can override this explicitly when reusing a build.
const E2E_BUILD = process.env.E2E_BUILD ?? (process.env.CI ? '0' : '1');
const browserChannel = configuredBrowserChannel();

export default defineConfig({
  testDir: './e2e/specs',
  // Built-route tests use isolated browser contexts and any harness servers
  // bind ephemeral ports. Allow Playwright to shard tests across files instead
  // of assigning whole, unevenly sized spec files to a shard. The worker cap
  // keeps runner memory bounded; set E2E_WORKERS=1 on constrained runners.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: Number(process.env.E2E_WORKERS ?? 2),
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Container-safe Chromium launch (CI runners / sandboxes without a usable
    // kernel sandbox or with small /dev/shm).
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'], ...(browserChannel ? { channel: browserChannel } : {}) },
  },

  projects: [
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 7'],
        // Pin viewport/scale regardless of the device profile so baselines are
        // reproducible across machines.
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        colorScheme: 'dark',
      },
    },
  ],

  webServer: {
    command: 'node e2e/serve.mjs',
    url: BASE_URL,
    // Reuse is explicit. A release gate must never pass against a process that
    // happens to be serving an older dist/ on the default local port.
    reuseExistingServer: process.env.E2E_REUSE_SERVER === '1' && !process.env.CI,
    // Next's static export can legitimately take several minutes on a cold
    // runner, especially when the SDK chunk is first compiled.
    timeout: 600_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      E2E_BUILD,
      PORT: String(PORT),
      NEXT_PUBLIC_PRIVY_APP_ID: '',
      NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL: '',
      NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL: '',
      NEXT_PUBLIC_TELEGRAM_APP_URL: 'https://t.me/FxAeonBot',
    },
  },
});
