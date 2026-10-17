import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { escapeAttribute, telegramLauncher, telegramStartLink } from './config.mjs';
import { qrSvg } from './qr.mjs';

const root = resolve(import.meta.dirname);
const telegramUrl = telegramLauncher(process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || undefined);
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of ['index.html', 'styles.css', 'script.js', 'hero-field.js', 'dollar-outcomes.js', 'market-data-client.mjs', 'market-data.mjs', '_routes.json', '404.html', 'robots.txt', 'sitemap.xml', 'document.css']) {
  await cp(resolve(root, file), resolve(dist, file));
  if (file === 'index.html') {
    // The source links the default bot; section links add the screen to open.
    const html = await readFile(resolve(dist, file), 'utf8');
    await writeFile(resolve(dist, file), html.replace(/https:\/\/t\.me\/FxAeonBot(?:\?startapp=([a-z][a-z0-9-]*))?/g,
      (_, startParam) => escapeAttribute(startParam ? telegramStartLink(telegramUrl, startParam) : telegramUrl)));
  }
}
await cp(resolve(root, '_headers'), resolve(dist, '_headers'));
// HTML revalidates on each visit, while Pages can cache scripts and styles for
// hours. Version the whole browser module graph so changes to an imported
// module also refresh its entry point for returning visitors.
const browserFiles = ['styles.css', 'document.css', 'script.js', 'hero-field.js', 'dollar-outcomes.js', 'market-data-client.mjs', 'market-data.mjs'];
const digest = createHash('sha256');
for (const file of browserFiles) {
  digest.update(file).update('\0').update(await readFile(resolve(dist, file))).update('\0');
}
const version = digest.digest('hex').slice(0, 16);
const browserReference = new RegExp(`(['"])((?:\\./|/)?)(?:${browserFiles.map(file => file.replaceAll('.', '\\.')).join('|')})\\1`, 'g');
for (const file of ['index.html', '404.html', ...browserFiles]) {
  const source = await readFile(resolve(dist, file), 'utf8');
  await writeFile(resolve(dist, file), source.replace(browserReference,
    reference => `${reference.slice(0, -1)}?v=${version}${reference.at(-1)}`));
}
// Ship only assets used by the current page; retired concept artwork stays out
// of the download. Font licenses remain alongside their referenced fonts.
const sources = await Promise.all(['index.html', 'styles.css', 'script.js', 'dollar-outcomes.js', '404.html', 'document.css']
  .map(file => readFile(resolve(root, file), 'utf8')));
const assets = new Set(sources.flatMap(source => [...source.matchAll(/assets\/[\w./-]+/g)].map(match => match[0])));
assets.add('assets/Inter-LICENSE.txt');
assets.add('assets/Manrope-LICENSE.txt');
assets.add('assets/Poppins-LICENSE.txt');
for (const asset of assets) {
  if (asset === 'assets/telegram-qr.svg') continue;
  await mkdir(dirname(resolve(dist, asset)), { recursive: true });
  const source = asset === 'assets/fx-protocol.svg' ? '../mini-app/public/brand/fx-official-mark.svg' : asset;
  await cp(resolve(root, source), resolve(dist, asset));
}
// The Telegram section's code for opening the bot on a phone encodes the same launcher.
await writeFile(resolve(dist, 'assets/telegram-qr.svg'), qrSvg(telegramUrl));
console.log(`Built ${dist}`);
