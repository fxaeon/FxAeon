import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Git may materialize checked-in YAML with CRLF on Windows. Keep the
// contract's structural substring checks independent of checkout settings.
const workflow = readFileSync(new URL('../.github/workflows/deploy-mini-app.yml', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const ciWorkflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const anvilWorkflow = readFileSync(new URL('../.github/workflows/anvil-fork.yml', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const verifyRunner = readFileSync(new URL('./verify.mjs', import.meta.url), 'utf8');
const productionEnvValidator = readFileSync(new URL('./validate_production_env.mjs', import.meta.url), 'utf8');
const pagesConfig = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const gasFunction = readFileSync(new URL('../functions/api/gas.ts', import.meta.url), 'utf8');

function step(name) {
  const start = workflow.indexOf(`      - name: ${name}`);
  assert.ok(start >= 0, `workflow step is missing: ${name}`);
  const next = workflow.indexOf('\n      - ', start + 1);
  return workflow.slice(start, next >= 0 ? next : workflow.length);
}

test('container shell steps trust only the checked-out workspace before verification', () => {
  const trust = step('Trust the container checkout');
  assert.match(trust, /git config --global --add safe\.directory "\$GITHUB_WORKSPACE"/);
  assert.match(trust, /git remote get-url origin > \/dev\/null/);
  assert.doesNotMatch(workflow, /safe\.directory[^\n]*\*/);
  assert.ok(workflow.indexOf('uses: actions/checkout@') < workflow.indexOf(trust));
  assert.ok(workflow.indexOf(trust) < workflow.indexOf('run: pnpm install --frozen-lockfile'));
});

test('push deployment requires successful same-repository main push CI; manual dispatch stays fully verified', () => {
  assert.match(workflow, /workflow_run:\s*\n\s+workflows: \[Client CI\]\s*\n\s+types: \[completed\]\s*\n\s+branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  const job = workflow.slice(workflow.indexOf('  deploy:'), workflow.indexOf('    runs-on:', workflow.indexOf('  deploy:')));
  assert.match(job, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
  for (const condition of [
    "github.event_name == 'workflow_run'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.head_branch == 'main'",
    'github.event.workflow_run.repository.full_name == github.repository',
  ]) assert.ok(job.includes(condition), `missing deployment gate ${condition}`);
  assert.match(workflow, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/);
  assert.match(workflow, /RELEASE_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/);

  const manualVerify = step('Run full verification for manual dispatch');
  assert.match(manualVerify, /if: github\.event_name == 'workflow_dispatch'/);
  assert.match(manualVerify, /run: pnpm verify/);
  assert.match(ciWorkflow, /run: pnpm verify --ci-source/);
  assert.match(ciWorkflow, /run: pnpm verify --ci-build/);
  assert.match(ciWorkflow, /run: pnpm verify --\$\{\{ matrix\.group \}\}/);
  for (const isolated of ['ci-isolated-0', 'ci-isolated-1', 'ci-isolated-2']) {
    assert.ok(verifyRunner.includes(isolated), `CI isolates ${isolated}`);
  }
  assert.match(ciWorkflow, /shard: \['1\/4', '2\/4', '3\/4', '4\/4'\]/);
  assert.match(ciWorkflow, /pnpm --dir apps\/mini-app exec playwright test --shard=/);
  assert.match(verifyRunner, /test:anvil:contract/);
  assert.match(anvilWorkflow, /workflow_dispatch:/, 'the real protected Anvil fork remains its separate manual gate');
});

test('production validation, manual verification when requested, and deployment build are ordered', () => {
  const validation = workflow.indexOf('run: pnpm verify:production-env');
  const verification = workflow.indexOf('run: pnpm verify\n');
  const productionBuild = workflow.indexOf('Build production deployment artifact');
  const artifactCheck = workflow.indexOf('Check production artifact');
  const stamp = workflow.indexOf('Stamp production revision');
  const secretSync = workflow.indexOf('Sync production Pages gas-oracle secret');
  const deploy = workflow.indexOf('Deploy verified production artifact');
  const revisionVerify = workflow.indexOf('Verify deployed revision');
  const gasCheck = workflow.indexOf('Check live gas-oracle binding');
  const gasVerify = workflow.indexOf('Verify live gas oracle');
  const liveConfig = workflow.indexOf('Verify live wallet configuration');
  const sync = workflow.indexOf('Sync Telegram bot metadata and menu');
  assert.ok(validation >= 0 && validation < productionBuild);
  assert.ok(verification > validation && verification < productionBuild);
  assert.ok(artifactCheck < stamp && stamp < secretSync && secretSync < deploy);
  assert.ok(deploy < revisionVerify && revisionVerify < gasCheck && gasCheck < gasVerify);
  assert.ok(gasVerify < liveConfig && liveConfig < sync);
});

test('manual full verification has no production public variables in scope', () => {
  const verification = step('Run full verification for manual dispatch');
  assert.match(verification, /run: pnpm verify/);
  assert.doesNotMatch(verification, /NEXT_PUBLIC_(?:PRIVY|ALCHEMY|TELEGRAM)/);
});

test('the deployed artifact is rebuilt with every required production public variable', () => {
  const productionBuild = step('Build production deployment artifact');
  assert.match(productionBuild, /run: \|\s*\n\s+pnpm build:landing\s*\n\s+pnpm build\s*\n/,
    'both exports exist before the built-artifact secret scan');
  for (const name of [
    'NEXT_PUBLIC_PRIVY_APP_ID',
    'NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL',
    'NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL',
    'NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL',
    'NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL',
    'NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL',
    'NEXT_PUBLIC_INFURA_BASE_RPC_URL',
    'NEXT_PUBLIC_ALCHEMY_DATA_API_KEY',
    'NEXT_PUBLIC_TELEGRAM_APP_URL',
  ]) {
    assert.match(productionBuild, new RegExp(`${name}:`));
  }
});

test('the verified production artifact is revision-stamped and uploaded only for the current main head', () => {
  assert.match(workflow, /permissions:\s*\n\s+contents: read\s*\n(?!\s+checks:)/);
  const currentMain = step('Require release commit is current main');
  assert.match(currentMain, /git ls-remote origin refs\/heads\/main/);
  assert.match(currentMain, /RELEASE_SHA/);
  assert.ok(workflow.indexOf(currentMain) < workflow.indexOf('Build production deployment artifact'));
  assert.doesNotMatch(workflow, /wait_for_cloudflare_check|checks: read|github\.token/);

  const artifactCheck = step('Check production artifact');
  assert.match(artifactCheck, /verify_frontend_secrets\.mjs --built/);
  assert.match(artifactCheck, /node scripts\/verify_built_rpc_config\.mjs/);
  for (const name of [
    'NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL',
    'NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL',
    'NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL',
    'NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL',
    'NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL',
    'NEXT_PUBLIC_INFURA_BASE_RPC_URL',
  ]) assert.ok(artifactCheck.includes(name + ': ${{ secrets.' + name + ' }}'));
  assert.match(artifactCheck, /pnpm check:bundle/);

  const stamp = step('Stamp production revision');
  assert.match(stamp, /node scripts\/release_revision\.mjs write "\$RELEASE_SHA"/);

  const deploy = step('Deploy verified production artifact');
  assert.match(deploy, /git ls-remote origin refs\/heads\/main/);
  assert.match(deploy, /\$RELEASE_SHA/);
  assert.match(deploy, /wrangler pages deploy apps\/mini-app\/dist --project-name=fxaeon --branch=main --commit-hash=/);
  assert.match(deploy, /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/);
  assert.match(deploy, /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{\s*secrets\.CLOUDFLARE_ACCOUNT_ID\s*\}\}/);
  assert.match(deploy, /WRANGLER_SEND_METRICS:\s*['"]?false/);
  assert.doesNotMatch(deploy, /working-directory:/);
  assert.match(deploy, /apps\/mini-app\/dist/);

  const revisionVerify = step('Verify deployed revision');
  assert.match(revisionVerify, /node scripts\/release_revision\.mjs verify "\$RELEASE_SHA"/);
  assert.match(revisionVerify, /GITHUB_SHA:\s*\$\{\{\s*env\.RELEASE_SHA\s*\}\}/);
  assert.match(workflow, /concurrency:\s*\n\s+group: fxaeon-production\s*\n\s+cancel-in-progress: false/);

  const secretSync = step('Sync production Pages gas-oracle secret');
  assert.match(secretSync, /id: gas_secret/);
  assert.match(secretSync, /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{\s*secrets\.CLOUDFLARE_ACCOUNT_ID\s*\}\}/);
  assert.match(secretSync, /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/);
  assert.match(secretSync, /ETHERSCAN_API_KEY:\s*\$\{\{\s*secrets\.ETHERSCAN_API_KEY\s*\}\}/);
  assert.match(secretSync, /printf '%s' "\$ETHERSCAN_API_KEY" \| pnpm exec wrangler pages secret put ETHERSCAN_API_KEY --project-name=fxaeon --env=production/);
  assert.match(secretSync, /configured=false/);
  assert.match(secretSync, /configured=true/);
  assert.match(secretSync, /RPC gas estimate fallback/);
  assert.match(secretSync, /Pages secret sync was not authorized/);
  assert.doesNotMatch(secretSync, /wrangler pages secret put[^\n]*\$\{\{/);
  assert.match(secretSync, /WRANGLER_SEND_METRICS:\s*['"]?false/);

  const gasCheck = step('Check live gas-oracle binding');
  assert.match(gasCheck, /run: node scripts\/check_live_gas_oracle\.mjs/);
  assert.match(gasCheck, /LIVE_GAS_ORACLE_URL:\s*https:\/\/fxaeon\.com\/api\/gas/);
  assert.doesNotMatch(workflow, /Redeploy verified artifact after syncing the Pages secret/);
  assert.match(pagesConfig, /^name = "fxaeon"$/m);
  assert.match(pagesConfig, /^pages_build_output_dir = "apps\/mini-app\/dist"$/m);
  assert.match(gasFunction, /export const onRequestGet/);
  assert.match(gasFunction, /env\?\.ETHERSCAN_API_KEY/);
  const gasVerify = step('Verify live gas oracle');
  assert.match(gasVerify, /if: steps\.gas_secret\.outputs\.configured == 'true'/);
  assert.match(gasVerify, /--require-configured/);
  assert.doesNotMatch(productionEnvValidator, /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/);
});

test('gas-oracle probe accepts only the explicit missing-binding response for its fallback', () => {
  const probe = readFileSync(new URL('./check_live_gas_oracle.mjs', import.meta.url), 'utf8');
  assert.match(probe, /status === 503[\s\S]*body\.error === 'gas oracle unavailable'/);
  assert.match(probe, /redirect:\s*'error'/);
  assert.match(probe, /cache:\s*'no-store'/);
  assert.match(probe, /--require-configured/);
  assert.doesNotMatch(probe, /console\.log\([^\n]*body/);
});

test('the published Cloudflare bundle is checked for the protected public wallet configuration', () => {
  const verification = step('Verify live wallet configuration');
  assert.match(verification, /run: node scripts\/verify_live_public_config\.mjs/);
  assert.match(verification, /EXPECTED_PUBLIC_PRIVY_APP_ID:\s*\$\{\{\s*secrets\.NEXT_PUBLIC_PRIVY_APP_ID\s*\}\}/);
  assert.match(verification, /GITHUB_SHA:\s*\$\{\{\s*env\.RELEASE_SHA\s*\}\}/);
  assert.match(verification, /LIVE_APP_URL:\s*https:\/\/fxaeon\.com/);
  assert.match(workflow, /TELEGRAM_WEB_APP_URL:\s*https:\/\/fxaeon\.com\//);
});

test('production validation keeps the local development Privy application out', () => {
  assert.match(productionEnvValidator, /cmu5tz4f000lp0cl5qtd87sro/);
  assert.match(productionEnvValidator, /local-development application/);
});
