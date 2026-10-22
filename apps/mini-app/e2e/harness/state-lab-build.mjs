import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const appRoot = resolve(here, '../..');
const root = resolve(appRoot, '../..');
const require = createRequire(resolve(root, 'package.json'));
const appRequire = createRequire(resolve(appRoot, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [appRoot] });
const esbuild = createRequire(tsxPackage)('esbuild');
const postcss = appRequire('postcss');
const tailwindcss = appRequire('tailwindcss');
const autoprefixer = appRequire('autoprefixer');
const entry = resolve(here, 'ui-state-lab-entry.tsx');
const src = resolve(appRoot, 'src');
const globalsCss = resolve(src, 'app/globals.css');
const productCss = resolve(src, 'app/product-shell.css');
const interFont = resolve(here, 'assets/inter-latin.woff2');

const mocks = {
  'next/navigation': `const router = { push: href => { history.pushState({}, '', href); } }; export const useRouter = () => router; export const usePathname = () => location.pathname;`,
  '@/components/PriceProvider': `export const useUsdPrices = () => ({ prices: { ETH: 2400, fxUSD: 1, USDC: 1, fxSAVE: 1.05 }, status: 'ready', updatedAt: Date.now() }); export const useLiveMarketQuote = () => ({ quote: null, status: 'unavailable', isFresh: false });`,
  '@/lib/telegram': `export const haptic = () => {}; export const openExternalLink = () => false; export const isTelegramLaunchContext = () => false;`,
};

/** Bundle only the dev catalog and its real presentation components. */
export async function buildUiStateLabBundle() {
  const result = await esbuild.build({
    entryPoints: [entry], outfile: resolve(appRoot, 'state-lab-bundle.js'), bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts', '.module.css': 'local-css' }, absWorkingDir: root,
    plugins: [{ name: 'ui-state-lab', setup(build) {
      build.onResolve({ filter: /^(?:@\/|next\/navigation$)/ }, (args) => {
        if (mocks[args.path]) return { path: args.path, namespace: 'mock' };
        const candidate = resolve(src, args.path.slice(2));
        if (existsSync(candidate) && statSync(candidate).isFile()) return { path: candidate };
        for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return { path: `${candidate}${extension}` };
        if (existsSync(candidate) && statSync(candidate).isDirectory()) {
          for (const extension of ['.tsx', '.ts']) if (existsSync(resolve(candidate, `index${extension}`))) return { path: resolve(candidate, `index${extension}`) };
        }
        return { path: candidate };
      });
      build.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: appRoot }));
    } }],
  });
  const script = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text;
  const modules = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  if (!script) throw new Error('The UI state lab JavaScript bundle was not emitted.');
  const [globalSource, productSource] = await Promise.all([readFile(globalsCss, 'utf8'), readFile(productCss, 'utf8')]);
  const tailwindConfig = appRequire(resolve(appRoot, 'tailwind.config.js'));
  tailwindConfig.content = [resolve(src, '**/*.{js,ts,jsx,tsx,mdx}')];
  const globals = await postcss([tailwindcss(tailwindConfig), autoprefixer]).process(
    `${globalSource}\n${productSource}`,
    { from: resolve(appRoot, 'e2e/state-lab-global.css') },
  );
  const fontAsset = await readFile(interFont);
  const fontCss = `@font-face{font-family:Inter;src:url('/state-lab-font.woff2') format('woff2');font-style:normal;font-weight:100 900;font-display:swap}`;
  return { script, css: `${fontCss}\n${globals.css}\n${modules}`, fontAsset };
}
