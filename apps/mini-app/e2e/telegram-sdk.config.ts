import { defineConfig } from '@playwright/test';
import overlay from '../playwright.overlay.config';

// Run after a production export with NEXT_PUBLIC_TELEGRAM_WALLET_MODE=passkey.
// Tests serve the actual export bytes; neither the SDK nor app modules are mocked.
export default defineConfig(overlay, {
  testDir: './telegram-sdk-specs',
  outputDir: '../test-results/telegram-sdk',
  timeout: 60_000,
});
