import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Content addresses the executable first-slice source, even in a dirty tree. */
export function sourceManifest(root) {
  const walk = (path) => readdirSync(resolve(root, path), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`]);
  const selected = [
    ...walk('src/protocol').filter(path => path.endsWith('.ts')),
    ...['amount', 'controller', 'errors', 'journal', 'ports', 'view'].map(name => `src/domain/${name}.ts`),
    'src/wallet/browser.ts', 'test/fork/guard.ts', 'test/fork/provider.ts', 'test/fork/manifest.ts', 'test/fork/native-long.test.ts',
    'scripts/fork-run.mjs', 'scripts/fork-process.mjs', 'scripts/fork-source.mjs',
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
    ...walk('vendor').filter(path => /fx-sdk.*\.patch$/.test(path)),
    'node_modules/@aladdindao/fx-sdk/package.json', 'node_modules/@aladdindao/fx-sdk/dist/index.js', 'node_modules/@aladdindao/fx-sdk/dist/index.cjs',
  ];
  const files = [...new Set(selected)].sort().map(path => ({ path,
    sha256: createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') }));
  const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  return Object.freeze({ schemaVersion: 1, algorithm: 'sha256', digest, files });
}
