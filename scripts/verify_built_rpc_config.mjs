import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RPC_VARIABLES = [
  'NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL',
  'NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL',
  'NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL',
  'NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL',
  'NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL',
  'NEXT_PUBLIC_INFURA_BASE_RPC_URL',
];

async function browserJavaScriptFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await browserJavaScriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) paths.push(path);
  }
  return paths;
}

function containsEndpointLiteral(source, value) {
  // Next inlines these values as strings. Match complete literals so an old
  // key cannot pass because it is a prefix of the replacement key. Accept
  // either quote style and optional slash escaping in emitted JavaScript.
  const doubleQuoted = JSON.stringify(value);
  const singleQuoted = `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  return [doubleQuoted, singleQuoted].some((literal) =>
    source.includes(literal) || source.includes(literal.replaceAll('/', '\\/')));
}

/** Verify build-time injection, not live provider health or failover behavior.
 * Return names only; public endpoint values must not enter CI diagnostics.
 */
export async function verifyBuiltRpcConfig(artifactDirectory, env = process.env) {
  const expected = RPC_VARIABLES.flatMap((name) => {
    const raw = env[name];
    // Next can inline the raw environment string before configuredRpcUrls
    // trims it at runtime. Both spellings represent the configured endpoint.
    return raw?.trim() ? [{ name, values: [raw, raw.trim()] }] : [];
  });
  // Server files, manifests and source maps do not establish browser inclusion.
  const paths = await browserJavaScriptFiles(resolve(artifactDirectory, '_next/static'));
  if (paths.length === 0) throw new Error('Browser JavaScript output is missing.');
  const missing = new Map(expected.map(({ name, values }) => [name, values]));
  for (const path of paths) {
    const source = await readFile(path, 'utf8');
    for (const [name, values] of missing) {
      if (values.some((value) => containsEndpointLiteral(source, value))) missing.delete(name);
    }
  }
  return { inspected: paths.length, configured: expected.length, missingNames: [...missing.keys()] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const artifactDirectory = process.argv[2] ?? resolve(import.meta.dirname, '../apps/mini-app/dist');
  try {
    if (process.argv.length > 3) throw new Error('Unexpected arguments.');
    const result = await verifyBuiltRpcConfig(artifactDirectory);
    for (const name of result.missingNames) console.error(`[rpc-config] ${name} is configured but missing from the browser bundle.`);
    console.log(`[rpc-config] ${result.inspected} browser JavaScript files checked; ${result.configured} configured RPC variables; ${result.missingNames.length} missing. Values are never printed.`);
    process.exitCode = result.missingNames.length ? 1 : 0;
  } catch {
    // Do not expose file contents, endpoint values or uncontrolled exceptions.
    console.error('[rpc-config] Cannot verify the built browser RPC configuration. Check the artifact directory and readable JavaScript output.');
    process.exitCode = 1;
  }
}
