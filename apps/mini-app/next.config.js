/** @type {import('next').NextConfig} */
const path = require('node:path');

const configuredDistDir = process.env.FX_E2E_DIST_DIR?.trim();
if (configuredDistDir && !/^[a-zA-Z0-9_-]+$/.test(configuredDistDir)) {
  throw new Error('FX_E2E_DIST_DIR must be a simple directory name inside the mini-app workspace');
}

const nextConfig = {
  output: 'export',
  // `pnpm lint` is an explicit release gate. Skipping Next's duplicate build
  // lint keeps static export output deterministic and avoids the framework's
  // legacy Pages-router plugin discovery warning with flat ESLint config.
  eslint: { ignoreDuringBuilds: true },
  // `pnpm typecheck` is an explicit release gate. Running it once after the
  // export is generated avoids a duplicate check and prevents Next's cleanup
  // of `.next/types` from racing the standalone TypeScript process.
  typescript: { ignoreBuildErrors: true },
  // Export static pages to `dist`. Next's export build can still use `.next`
  // as an intermediate directory, so never run `next dev` and `next build`
  // concurrently in this checkout, even with different final output paths.
  distDir: configuredDistDir || (process.env.NODE_ENV === 'development' ? '.next' : 'dist'),
  images: { unoptimized: true },
  webpack: (config, { webpack, isServer }) => {
    // Wallet/data libraries share a vendor graph. Keep that graph in bounded,
    // cacheable chunks instead of growing one mobile-WebView download every
    // time a shared hook is added. The independent release budgets still
    // check both the largest chunk and the full raw/gzipped JavaScript total.
    if (!isServer && config.optimization?.splitChunks) {
      config.optimization.splitChunks.maxSize = 1_900_000;
    }
    // Privy's optional CAPTCHA screen imports @hcaptcha/loader. The upstream
    // loader bundles a hCaptcha-owned Sentry client and DSN; FxAeon has no
    // telemetry authority, so keep the script/token API but remove that
    // diagnostic implementation from the shipped browser artifact.
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@hcaptcha/loader$': path.resolve(__dirname, 'src/lib/hcaptcha-loader.ts'),
    };
    // Privy publishes optional integrations as dynamic imports in its main
    // entrypoint. FxAeon does not enable Stripe onramping or Farcaster/Solana;
    // explicitly ignore those optional peers instead of shipping dead code or
    // producing a misleading module-not-found warning on every release build.
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^(@stripe\/crypto|@farcaster\/mini-app-solana)$/,
      })
    );
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
