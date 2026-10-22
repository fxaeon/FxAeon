import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const app = JSON.parse(readFileSync(new URL('../apps/mini-app/package.json', import.meta.url), 'utf8'));
const browserVersion = app.devDependencies['@playwright/test'];
const workflows = Object.fromEntries(['ci', 'e2e-mini-app', 'release', 'deploy-mini-app'].map(name => [name,
  load(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8')),
]));
const browserJobs = [
  workflows.ci.jobs.source, workflows.ci.jobs['built-e2e'], workflows.ci.jobs['isolated-e2e'],
  workflows['e2e-mini-app'].jobs.e2e, workflows.release.jobs.verify, workflows['deploy-mini-app'].jobs.deploy,
];

test('every optimized browser job uses one immutable image matching the installed Playwright version', () => {
  const images = new Set(browserJobs.map(job => job.container.image));
  assert.equal(images.size, 1, 'all browser jobs share the same dependency/runtime image');
  const [image] = images;
  assert.match(image, /^mcr\.microsoft\.com\/playwright:v[\d.]+-noble@sha256:[a-f0-9]{64}$/);
  assert.equal(image.split(':v')[1].split('-noble')[0], browserVersion);
  for (const job of browserJobs) {
    assert.equal(job.container.options, '--init --ipc=host');
    assert.ok(!job.steps.some(step => /playwright\s+install|apt-get|apt\s+install/.test(step.run ?? '')), 'browsers/system libraries come from the pinned image');
    assert.ok(job.steps.some(step => step.run === 'pnpm install --frozen-lockfile'));
    assert.equal(job.steps.find(step => step.uses?.startsWith('actions/setup-node@'))?.with['node-version'], '22');
    assert.equal(job.steps.find(step => step.uses?.startsWith('pnpm/action-setup@'))?.with.version, '11.19.0');
  }
});

test('container setup preserves browser shards, isolated groups and the complete verification gate', () => {
  const jobs = workflows.ci.jobs;
  assert.deepEqual(jobs['built-e2e'].strategy.matrix.shard, ['1/4', '2/4', '3/4', '4/4']);
  assert.deepEqual(jobs['isolated-e2e'].strategy.matrix.group, ['ci-isolated-0', 'ci-isolated-1', 'ci-isolated-2']);
  assert.equal(jobs['built-e2e'].needs, 'build');
  assert.equal(jobs['built-e2e'].steps.find(step => step.run?.includes('playwright test --shard='))?.env.E2E_BUILD, '0');
  assert.deepEqual(jobs.verify.needs, ['source', 'build', 'built-e2e', 'isolated-e2e']);
  assert.equal(jobs.verify.if, '${{ always() }}');
  assert.equal(jobs['built-e2e'].strategy['fail-fast'], false);
  assert.equal(jobs['isolated-e2e'].strategy['fail-fast'], false);
});

test('container deployment retains Bash semantics and both deterministic and production-configured builds', () => {
  const deploy = workflows['deploy-mini-app'].jobs.deploy;
  assert.equal(deploy.defaults.run.shell, 'bash');
  assert.equal(deploy.environment, 'production');
  const verification = deploy.steps.findIndex(step => step.run === 'pnpm verify');
  const productionBuild = deploy.steps.findIndex(step => step.name === 'Build production deployment artifact');
  assert.ok(verification >= 0 && productionBuild > verification);
  assert.equal(deploy.steps[productionBuild].env.NEXT_PUBLIC_PRIVY_APP_ID, '${{ secrets.NEXT_PUBLIC_PRIVY_APP_ID }}');
});
