/** @type {import('next').NextConfig} */
const path = require('node:path');
const { availableParallelism, totalmem } = require('node:os');
const { installOptInPlugin } = require('./scripts/webpack-module-attribution-plugin.cjs');

// Static page workers each retain the app's wallet graph. Bound their memory
// use on laptops while keeping parallel export work on larger build runners.
const buildWorkers = Math.max(1, Math.min(availableParallelism(), totalmem() < 12 * 1024 ** 3 ? 2 : 4));

const configuredDistDir = process.env.FX_E2E_DIST_DIR?.trim();
if (configuredDistDir && !/^[a-zA-Z0-9_-]+$/.test(configuredDistDir)) {
  throw new Error('FX_E2E_DIST_DIR must be a simple directory name inside the mini-app workspace');
}

const nextConfig = {
  output: 'export',
  experimental: { cpus: buildWorkers, webpackBuildWorker: true },
  // `pnpm lint` is an explicit release gate. Next 16 no longer accepts the
  // legacy `eslint` build configuration; the CLI runs lint independently.
  // `pnpm typecheck` is an explicit release gate. Running it once after the
  // export is generated avoids a duplicate check and prevents Next's cleanup
  // of `.next/types` from racing the standalone TypeScript process.
  typescript: { ignoreBuildErrors: true },
  // Export static pages to `dist`. Next's export build can still use `.next`
  // as an intermediate directory, so never run `next dev` and `next build`
  // concurrently in this checkout, even with different final output paths.
  distDir: configuredDistDir || (process.env.NODE_ENV === 'development' ? '.next' : 'dist'),
  images: { unoptimized: true },
  webpack: (config, { isServer }) => {
    // Private, read-only module/chunk attribution for an explicitly requested
    // client build. The plugin writes under .cache, never the export directory.
    installOptInPlugin(config, { env: process.env, isServer });
    // Read-only evidence for the disposable local-fork test artifact only.
    // Keep this out of normal builds instead of retaining hidden product UI.
    if (process.env.FX_E2E_REVIEW_EVIDENCE === '1') {
      if (process.env.NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE !== '1') {
        throw new Error('Review evidence instrumentation requires local-fork test mode');
      }
      config.module.rules.push({
        test: /[\\/]components[\\/]ActionReview\.tsx$/,
        enforce: 'pre',
        use: [{ loader: path.resolve(__dirname, 'e2e/fork/review-evidence-loader.cjs') }],
      });
    }
    // Wallet/data libraries share a vendor graph. Keep that graph in bounded,
    // cacheable chunks instead of growing one mobile-WebView download every
    // time a shared hook is added. The independent release budgets still
    // check both the largest chunk and the full raw/gzipped JavaScript total.
    if (!isServer && config.optimization?.splitChunks) {
      config.optimization.splitChunks.maxSize = 1_900_000;
    }
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      // ox/viem's Tempo worker loader intentionally selects a module at
      // runtime. Webpack cannot statically enumerate it, but it is not used by
      // FxAeon's Ethereum-only routes.
      { module: /ox[\\/]_esm[\\/]tempo[\\/]internal[\\/]virtualMasterPool/, message: /Critical dependency/ },
    ];
    return config;
  },
};

module.exports = nextConfig;
