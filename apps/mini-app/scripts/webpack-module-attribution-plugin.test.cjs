'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createReport,
  installOptInPlugin,
  isEnabled,
  privateReportDirectory,
} = require('./webpack-module-attribution-plugin.cjs');

test('attribution stays disabled by default and on server compilers', () => {
  assert.equal(isEnabled({}, false), false);
  assert.equal(isEnabled({ FX_WEBPACK_ATTRIBUTION: 'true' }, false), false);
  assert.equal(isEnabled({ FX_WEBPACK_ATTRIBUTION: '1' }, true), false);

  const config = { plugins: [] };
  assert.equal(installOptInPlugin(config, { env: {}, isServer: false }), false);
  assert.deepEqual(config.plugins, []);
  assert.equal(installOptInPlugin(config, { env: { FX_WEBPACK_ATTRIBUTION: '1' }, isServer: true }), false);
  assert.deepEqual(config.plugins, []);
});

test('opt-in installs one plugin only for the client compiler', () => {
  const config = { plugins: [] };
  assert.equal(installOptInPlugin(config, { env: { FX_WEBPACK_ATTRIBUTION: '1' }, isServer: false }), true);
  assert.equal(config.plugins.length, 1);
});

test('private report directory stays outside the publishable output', () => {
  const reportDir = privateReportDirectory('C:\\repo\\apps\\mini-app', 'C:\\repo\\apps\\mini-app\\dist');
  assert.equal(reportDir, 'C:\\repo\\apps\\mini-app\\.cache\\webpack-module-attribution');
  assert.throws(
    () => privateReportDirectory('C:\\repo\\apps\\mini-app', 'C:\\repo\\apps\\mini-app\\.cache'),
    /overlaps the configured build output/,
  );
});

test('report includes chunk assets, issuer, size estimates, and nested concatenated modules without source or query data', () => {
  const secret = 'fixture-secret-that-must-not-escape';
  const child = {
    identifier: () => `C:\\repo\\node_modules\\@fx\\wallet\\dist\\session.js?token=${secret}`,
    size: () => 37,
    type: 'javascript/esm',
  };
  const entry = {
    identifier: () => `C:\\private\\unsafe-loader.js?key=${secret}!C:\\repo\\apps\\mini-app\\src\\entry.tsx?key=${secret}`,
    size: () => 83,
    type: 'javascript/auto',
    modules: new Set([child]),
  };
  const issuer = {
    identifier: () => `D:\\users\\private\\issuer.js?credential=${secret}`,
  };
  const compilation = {
    errors: [],
    chunks: [{
      id: 7,
      name: 'app-home',
      files: new Set(['static/chunks/home-abc123.js']),
      canBeInitial: () => true,
    }],
    chunkGraph: {
      getChunkModulesIterable: () => new Set([entry]),
      getModuleId: (module) => module === entry ? 7 : undefined,
    },
    moduleGraph: {
      getIssuer: (module) => module === entry ? issuer : entry,
    },
  };

  const report = createReport(compilation, 'C:\\repo\\apps\\mini-app');
  const serialized = JSON.stringify(report);
  assert.equal(report.chunks[0].assets[0], 'home-abc123.js');
  assert.equal(report.chunks[0].initial, true);
  assert.equal(report.chunks[0].modules[0].label, 'app:src/entry.tsx');
  assert.equal(report.chunks[0].modules[0].estimatedBytes, 83);
  assert.equal(report.chunks[0].modules[0].issuer, '[external-or-virtual]');
  assert.equal(report.chunks[0].modules[0].nestedModules[0].label, 'npm:@fx/wallet/dist/session.js');
  assert.equal(report.chunks[0].modules[0].nestedModules[0].estimatedBytes, 37);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('unsafe-loader'), false);
  assert.equal(serialized.includes('credential'), false);
  assert.equal(serialized.includes('export default'), false);
});
