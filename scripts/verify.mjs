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

const phase = (process.argv[2] ?? 'all').replace(/^--/, '');
const validPhases = new Set(['all', 'ci-source', 'ci-build', 'ci-isolated-0', 'ci-isolated-1', 'ci-isolated-2']);
if (!validPhases.has(phase)) {
  console.error(`[verify] unknown phase: ${phase}`);
  process.exit(2);
}

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

async function runLimited(checks, concurrency) {
  const results = new Array(checks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, checks.length) }, async () => {
    while (next < checks.length) {
      const index = next++;
      results[index] = await checks[index].run();
    }
  });
  await Promise.all(workers);
  return results;
}

async function runGroup(checks, group) {
  const results = await runLimited(
    checks.map(({ args, label }) => ({ run: () => pnpmRun(args, label) })),
    4,
  );
  const failed = results.filter((code) => code !== 0);
  if (failed.length) {
    console.error(`[verify] ${group} failed (${failed.length} check${failed.length === 1 ? '' : 's'})`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

async function verifySource() {
const scope = await pnpmRun(['verify:scope'], 'scope verification');
if (scope !== 0) return scope;
const architecture = await pnpmRun(['verify:architecture'], 'architecture verification');
if (architecture !== 0) return architecture;
const landingBuild = await pnpmRun(['build:landing'], 'standalone landing build');
if (landingBuild !== 0) return landingBuild;

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
  { args: ['exec', 'node', '--test', 'scripts/verify_phases.contract.test.mjs'], label: 'Verification runner phase contract' },
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
  return 1;
}
if (phase === 'ci-source') {
  const landingBrowser = await pnpmRun(['test:landing:browser'], 'standalone landing browser checks');
  if (landingBrowser !== 0) return landingBrowser;
}
return 0;
}

if (phase === 'all' || phase === 'ci-source') {
  const sourceStartedAt = Date.now();
  const sourceResult = await verifySource();
  console.log(`[verify] source phase completed in ${((Date.now() - sourceStartedAt) / 1000).toFixed(1)}s`);
  if (sourceResult !== 0) process.exit(sourceResult);
  if (phase === 'ci-source') process.exit(process.exitCode ?? 0);
}

if (phase === 'all' || phase === 'ci-build') {
const buildStartedAt = Date.now();
const build = await pnpmRun(['build'], 'production build', E2E_BUILD_ENV);
if (build !== 0) {
  console.error(`[verify] build phase failed after ${((Date.now() - buildStartedAt) / 1000).toFixed(1)}s`);
  process.exit(build);
}

const builtChecks = await runLimited([
  { run: () => run(process.execPath, ['scripts/verify_frontend_secrets.mjs', '--built'], 'Built frontend secret scan') },
  { run: () => pnpmRun(['typecheck'], 'typecheck') },
  { run: () => pnpmRun(['check:bundle'], 'bundle check') },
  ...(phase === 'all' ? [
    { run: () => run(process.execPath, ['scripts/run_built_e2e.mjs'], 'built-route E2E') },
    { run: () => pnpmRun(['test:landing:browser'], 'standalone landing browser checks') },
  ] : []),
], 3);
const builtFailures = builtChecks.filter((code) => code !== 0);
if (builtFailures.length) {
  console.error(`[verify] build-dependent checks failed (${builtFailures.length})`);
  process.exitCode = 1;
}
console.log(`[verify] build phase completed in ${((Date.now() - buildStartedAt) / 1000).toFixed(1)}s`);
}

// Isolated browser harnesses are separate Playwright projects so their
// fixtures never leak into the production mini-app E2E suite. Run at most two
// after the shared build gates to keep browser memory bounded.
const isolatedBrowserChecks = [
  { args: ['test:e2e:borrow-harness'], label: 'Borrow selection browser harness' },
  { args: ['test:e2e:move-harness'], label: 'Move review layout browser harness' },
  { args: ['test:e2e:positions-harness'], label: 'Positions review layout browser harness' },
  { args: ['test:e2e:privy-send-harness'], label: 'Privy embedded send adapter browser harness' },
  { args: ['test:e2e:trade-harness'], label: 'Trade native Max lifecycle browser harness' },
  { args: ['test:e2e:wallet-provider-harness'], label: 'Telegram-only Privy provider routing browser harness' },
  { args: ['test:e2e:mobile-wallet-harness'], label: 'Mobile wallet-browser handoff browser harness' },
  { args: ['test:e2e:overlay'], label: 'Overlay lifecycle browser harness' },
  { args: ['test:e2e:state-lab'], label: 'UI state lab browser suite' },
];
const isolatedGroups = [
  [isolatedBrowserChecks[7]],
  [isolatedBrowserChecks[6], isolatedBrowserChecks[1]],
  [isolatedBrowserChecks[0], isolatedBrowserChecks[2], isolatedBrowserChecks[3], isolatedBrowserChecks[4], isolatedBrowserChecks[5], isolatedBrowserChecks[8]],
];
const isolatedGroupIndex = phase.startsWith('ci-isolated-') ? Number(phase.slice('ci-isolated-'.length)) : null;
const selectedIsolatedChecks = isolatedGroupIndex === null
  ? isolatedBrowserChecks
  : isolatedGroups[isolatedGroupIndex];
const shouldRunIsolated = phase === 'all' || isolatedGroupIndex !== null;
if (shouldRunIsolated) {
  const isolatedStartedAt = Date.now();
  const isolatedResults = await runLimited(
    selectedIsolatedChecks.map((check) => ({ run: () => pnpmRun(check.args, check.label) })),
    2,
  );
  const isolatedFailures = isolatedResults.flatMap((code, index) => code === 0 ? [] : [selectedIsolatedChecks[index].label]);
  if (isolatedFailures.length) {
    console.error(`[verify] isolated browser checks failed: ${isolatedFailures.join(', ')}`);
    process.exitCode = 1;
  }
  console.log(`[verify] isolated browser phase completed in ${((Date.now() - isolatedStartedAt) / 1000).toFixed(1)}s`);
}
