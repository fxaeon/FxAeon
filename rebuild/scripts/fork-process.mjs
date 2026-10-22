import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname } from 'node:path';
import { rpcExchange } from '../test/fork/guard.ts';

export function childEnvironment(extra = {}, upstream = false) {
  const environment = { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}` };
  for (const name of ['TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR']) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  // Only Anvil's read-only upstream transport receives existing proxy settings.
  // The test process receives no archive URL, provider key, or application secret.
  if (upstream) {
    for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) {
      if (process.env[name]) environment[name] = process.env[name];
    }
  } else environment.NO_PROXY = '127.0.0.1';
  return { ...environment, ...extra };
}

export function anvilVersion(binary) {
  try {
    const value = execFileSync(binary, ['--version'], { env: childEnvironment(), encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] });
    const version = value.match(/^anvil Version: ([0-9]+\.[0-9]+\.[0-9]+)$/m)?.[1];
    if (!version) throw new Error();
    return version;
  } catch { throw new Error('The configured Anvil executable could not prove its version.'); }
}

export async function terminateOwned(child) {
  const signal = (name) => {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') child.kill(name);
      else process.kill(-child.pid, name);
    } catch (error) { if (error?.code !== 'ESRCH') throw error; }
  };
  // The detached group belongs only to this launch, including an npm shim's
  // executable child. Never kill by name or touch an existing local node.
  signal('SIGTERM');
  if (child.exitCode !== null || child.signalCode !== null) return;
  let timer;
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => { timer = setTimeout(() => { signal('SIGKILL'); resolve(); }, 2_000); }),
  ]);
  clearTimeout(timer);
}

export async function launchAnvil({ binary, forkUrl, blockNumber }) {
  const reservation = createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a loopback port.');
  const port = address.port;
  await new Promise(resolve => reservation.close(resolve));
  const args = ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '1', '--accounts', '0', '--quiet', '--no-cors'];
  if (forkUrl) {
    if (typeof blockNumber !== 'bigint' || blockNumber <= 0n) throw new Error('Anvil requires a proved positive fork block.');
    args.push('--fork-url', forkUrl, '--fork-block-number', String(blockNumber),
      '--no-storage-caching', '--retries', '0', '--timeout', '15000');
  }
  const child = spawn(binary, args, { env: childEnvironment({}, Boolean(forkUrl)), detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
  let spawnFailed = false;
  child.on('error', () => { spawnFailed = true; });
  const url = `http://127.0.0.1:${port}/`;
  const request = rpcExchange(url, globalThis.fetch.bind(globalThis), 750);
  try {
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      if (spawnFailed || child.exitCode !== null || child.signalCode !== null) throw new Error('The owned Anvil process exited before becoming ready.');
      try {
        const client = await request('web3_clientVersion');
        if (typeof client === 'string' && /^anvil\b/i.test(client)) return { child, url, stop: () => terminateOwned(child) };
      } catch { /* A bounded startup poll is not a fork identity proof. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('The owned Anvil process did not become ready within 40 seconds.');
  } catch (error) { await terminateOwned(child); throw error; }
}
