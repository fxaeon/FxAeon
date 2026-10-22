import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// CI uses Playwright 1.64.1's pinned Chromium 156. The current workspace's
// pinned-browser download was truncated. Its explicitly identifiable 153
// fallback is supplemental checkpoint evidence, never pinned-browser proof.
const localSupplementalBrowser = '/tmp/fxaeon-chromium/chromium';
const executablePath = process.env.FXAEON_CHROMIUM_EXECUTABLE
  ?? (!process.env.CI && existsSync(localSupplementalBrowser) ? localSupplementalBrowser : undefined);
const reportTag = process.env.FXAEON_BROWSER_REPORT_TAG ?? '';
if (reportTag && !/^[a-z0-9-]{1,40}$/.test(reportTag)) throw new Error('Invalid browser evidence tag.');
const reportSuffix = reportTag ? `-${reportTag}` : '';

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: `./docs/evidence/browser-results${reportSuffix}`,
  reporter: [
    ['list'],
    ['json', { outputFile: `./docs/evidence/browser-results${reportSuffix}.json` }],
    ['html', { outputFolder: `./docs/evidence/browser-report${reportSuffix}`, open: 'never' }],
  ],
  metadata: {
    checkpoint: 'Supplemental step-3 fixture acceptance; no public transactions or native-device proof',
    playwright: '1.64.1',
    pinnedChromium: '156',
    executable: executablePath ?? 'Playwright-managed pinned browser',
    browserLimitation: executablePath === localSupplementalBrowser ? 'Chromium 153.0.8010.0 fallback; pinned 156 download failed' : 'Actual version recorded in test attachments',
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    launchOptions: executablePath ? { executablePath } : {},
    viewport: { width: 1280, height: 900 },
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'node scripts/serve.mjs --dir dist-fixture --port 4173',
    url: 'http://127.0.0.1:4173/app/',
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
