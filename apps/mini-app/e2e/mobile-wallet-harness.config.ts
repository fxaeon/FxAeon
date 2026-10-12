import { defineConfig, devices } from '@playwright/test';
import { configuredBrowserChannel } from '../../../scripts/e2e_browser_channel.cjs';

const browserChannel = configuredBrowserChannel(process.env);

export default defineConfig({
  testDir: './specs',
  testMatch: 'mobile-wallet.spec.ts',
  outputDir: '../../../output/playwright/mobile-wallet-harness',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    ...(browserChannel ? { launchOptions: { channel: browserChannel } } : {}),
  },
});
