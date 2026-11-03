import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const root = import.meta.dirname;
const require = createRequire(import.meta.url);
await build({ entryPoints: [resolve(root, 'vendor.js')], bundle: true, format: 'iife', outfile: resolve(root, 'vendor.min.js'), minify: true });
await copyFile(require.resolve('gsap/dist/gsap.min.js'), resolve(root, 'gsap.min.js'));
