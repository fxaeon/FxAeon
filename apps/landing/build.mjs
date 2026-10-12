import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { escapeAttribute, telegramLauncher, telegramStartLink } from './config.mjs';
import { qrSvg } from './qr.mjs';

const root = resolve(import.meta.dirname);
const telegramUrl = telegramLauncher(process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || undefined);
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of ['index.html', 'styles.css', 'script.js', '404.html', 'robots.txt', 'sitemap.xml', 'document.css']) {
  await cp(resolve(root, file), resolve(dist, file));
  if (file === 'index.html') {
    // The source links the default bot; section links add the screen to open.
    const html = await readFile(resolve(dist, file), 'utf8');
    await writeFile(resolve(dist, file), html.replace(/https:\/\/t\.me\/FxAeonBot(?:\?startapp=([a-z][a-z0-9-]*))?/g,
      (_, startParam) => escapeAttribute(startParam ? telegramStartLink(telegramUrl, startParam) : telegramUrl)));
  }
}
await cp(resolve(root, '_headers'), resolve(dist, '_headers'));
await cp(resolve(root, 'assets'), resolve(dist, 'assets'), { recursive: true });
await cp(resolve(root, '../mini-app/public/brand/fx-official-mark.svg'), resolve(dist, 'assets/fx-protocol.svg'));
// The Telegram section's code for opening the bot on a phone encodes the same launcher.
await writeFile(resolve(dist, 'assets/telegram-qr.svg'), qrSvg(telegramUrl));
console.log(`Built ${dist}`);
