import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { E2E_BUILD_ENV } from './e2e_build_env.mjs';

/**
 * Release verification runner.
 *
 * The checks are independent until the production export exists, so run the
 * static checks together and only serialize the build-dependent gates. This
 * preserves every check in the release contract while avoiding idle time on
 * the Windows CI runner.
 */

const root = process.cwd();
const pnpm = process.env.npm_execpath && existsSync(process.env.npm_execpath)
  ? { command: process.execPath, prefix: [process.env.npm_execpath] }
  : { command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', prefix: [] };

function run(command, args, label, envOverrides = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, ...envOverrides },
    });
    child.once('error', (error) => {
      console.error(`[verify] ${label} could not start: ${error.message}`);
      resolve(1);
    });
    child.once('exit', (code, signal) => {
      if (signal) {
        console.error(`[verify] ${label} stopped on ${signal}`);
        resolve(1);
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

function pnpmRun(args, label, envOverrides) {
  return run(pnpm.command, [...pnpm.prefix, ...args], label, envOverrides);
}

async function runGroup(checks, group) {
  const results = await Promise.all(checks.map(({ args, label }) => pnpmRun(args, label)));
  const failed = results.filter((code) => code !== 0);
  if (failed.length) {
    console.error(`[verify] ${group} failed (${failed.length} check${failed.length === 1 ? '' : 's'})`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

const scope = await pnpmRun(['verify:scope'], 'scope verification');
if (scope !== 0) process.exit(scope);
const architecture = await pnpmRun(['verify:architecture'], 'architecture verification');
if (architecture !== 0) process.exit(architecture);
const landingBuild = await pnpmRun(['build:landing'], 'standalone landing build');
if (landingBuild !== 0) process.exit(landingBuild);

// Lightweight checks can overlap. Run the complete test glob once in a single
// tsx process: it includes the Anvil-contract skips and seeded chaos campaign,
// so every assertion executes without paying for a second compiler startup.
const quickChecks = await runGroup([
  { args: ['lint'], label: 'lint' },
  { args: ['test:anvil:contract'], label: 'Anvil harness contract' },
  { args: ['test:deploy-workflow'], label: 'Deployment workflow contract' },
  { args: ['exec', 'node', '--test', 'scripts/build_environment.contract.test.mjs'], label: 'Build environment contract' },
  { args: ['test:telegram:contract'], label: 'Telegram deployment contract' },
  { args: ['test:live-public-config:contract'], label: 'Live public configuration contract' },
  { args: ['test:architecture:contract'], label: 'Architecture import contract' },
  { args: ['exec', 'node', '--test', 'scripts/generate_csp_headers.contract.test.mjs'], label: 'CSP generation contract' },
  { args: ['exec', 'node', '--test', 'scripts/cloudflare_headers.contract.test.mjs'], label: 'Cloudflare headers contract' },
  { args: ['exec', 'node', '--test', 'apps/mini-app/test/e2e-serve.test.mjs'], label: 'Static E2E server route contract' },
  { args: ['test:landing'], label: 'Standalone landing contract' },
  { args: ['exec', 'node', '--test', 'scripts/verify_frontend_secrets.test.mjs', 'scripts/launch_readiness.test.mjs'], label: 'Launch readiness contracts' },
  { args: ['exec', 'node', 'scripts/verify_frontend_secrets.mjs'], label: 'Frontend secret scan' },
  {
    args: ['run', 'audit:all'],
    label: 'dependency audit',
  },
], 'parallel lightweight checks');
const tests = await pnpmRun(['test'], 'unit and chaos tests');
if (!quickChecks || tests !== 0) {
  console.error('[verify] source checks failed');
  process.exit(1);
}

const build = await pnpmRun(['build'], 'production build', E2E_BUILD_ENV);
if (build !== 0) process.exit(build);

const builtChecks = await Promise.all([
  run(process.execPath, ['scripts/verify_frontend_secrets.mjs', '--built'], 'Built frontend secret scan'),
  pnpmRun(['typecheck'], 'typecheck'),
  pnpmRun(['check:bundle'], 'bundle check'),
  run(process.execPath, ['scripts/run_built_e2e.mjs'], 'built-route E2E'),
  pnpmRun(['test:landing:browser'], 'standalone landing browser checks'),
]);
const builtFailures = builtChecks.filter((code) => code !== 0);
if (builtFailures.length) {
  console.error(`[verify] build-dependent checks failed (${builtFailures.length})`);
  process.exitCode = 1;
}

// Isolated browser harnesses are separate Playwright projects so their
// fixtures never leak into the production mini-app E2E suite. Run them one
// at a time after the shared build gates to keep browser memory bounded.
const isolatedBrowserChecks = [
  { args: ['test:e2e:borrow-harness'], label: 'Borrow selection browser harness' },
  { args: ['test:e2e:move-harness'], label: 'Move review layout browser harness' },
  { args: ['test:e2e:positions-harness'], label: 'Positions review layout browser harness' },
  { args: ['test:e2e:privy-send-harness'], label: 'Privy embedded send adapter browser harness' },
  { args: ['test:e2e:trade-harness'], label: 'Trade native Max lifecycle browser harness' },
  { args: ['test:e2e:wallet-provider-harness'], label: 'Telegram-only Privy provider routing browser harness' },
  { args: ['test:e2e:overlay'], label: 'Overlay lifecycle browser harness' },
  { args: ['test:e2e:state-lab'], label: 'UI state lab browser suite' },
];
const isolatedFailures = [];
for (const check of isolatedBrowserChecks) {
  const code = await pnpmRun(check.args, check.label);
  if (code !== 0) isolatedFailures.push(check.label);
}
if (isolatedFailures.length) {
  console.error(`[verify] isolated browser checks failed: ${isolatedFailures.join(', ')}`);
  process.exitCode = 1;
}
