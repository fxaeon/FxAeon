import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLOUDFLARE_MAX_HEADER_LINE_LENGTH = 2_000;
const GENERATED_META_MARKER = 'data-fxaeon-generated-csp="true"';
const META_UNSUPPORTED_DIRECTIVES = new Set([
  'frame-ancestors',
  'report-uri',
  'report-to',
  'sandbox',
]);

function directiveName(directive) {
  return directive.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
}

function parseDirectives(policy) {
  const directives = policy.split(';').map((item) => item.trim()).filter(Boolean);
  const names = directives.map(directiveName);
  if (new Set(names).size !== names.length) {
    throw new Error('Content-Security-Policy contains duplicate directives');
  }
  return directives;
}

function getSourcePolicy(headerFile) {
  const lines = headerFile.split(/\r?\n/);
  const matching = lines.filter((line) => /^\s*Content-Security-Policy\s*:/i.test(line));
  if (matching.length !== 1) {
    throw new Error(`expected exactly one source Content-Security-Policy header; found ${matching.length}`);
  }
  return matching[0].replace(/^\s*Content-Security-Policy\s*:\s*/i, '').trim();
}

export function hashInlineScripts(html) {
  const hashes = new Set();
  for (const match of html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const source = match[1];
    if (source) hashes.add(`'sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}'`);
  }
  return [...hashes].sort();
}

function escapeAttribute(value) {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Content-Security-Policy contains an HTML attribute control character');
  }
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function removeGeneratedMeta(html) {
  return html.replace(
    /<meta\b(?=[^>]*\bdata-fxaeon-generated-csp\s*=\s*(?:"true"|'true'))[^>]*\/?>/gi,
    '',
  );
}

function insertMetaAfterCharset(html, metaTag) {
  const head = /<head\b[^>]*>/i.exec(html);
  const charset = /<meta\b[^>]*\bcharset\s*=\s*(?:"[^"]+"|'[^']+'|[^\s/>]+)[^>]*\/?>/i.exec(html);
  if (!head || !charset || charset.index < head.index + head[0].length) {
    throw new Error('static HTML must start its head with a charset meta element');
  }

  const headEnd = html.indexOf('</head>', head.index + head[0].length);
  if (headEnd < 0 || charset.index + charset[0].length > headEnd) {
    throw new Error('static HTML charset meta element is outside the document head');
  }

  const before = html.slice(0, charset.index);
  const afterCharset = charset.index + charset[0].length;
  const firstExecutableTag = /<(?:script\b|link\b(?=[^>]*\brel\s*=\s*["']?preload\b)(?=[^>]*\bas\s*=\s*["']?script\b))[^>]*>/i.exec(html);
  if (firstExecutableTag && firstExecutableTag.index < afterCharset) {
    throw new Error('static HTML has an executable script or preload before the charset meta element');
  }

  return `${before}${charset[0]}${metaTag}${html.slice(afterCharset)}`;
}

export function buildCspPolicies(sourcePolicy, inlineScripts) {
  const directives = parseDirectives(sourcePolicy);
  const scriptDirective = directives.find((item) => directiveName(item) === 'script-src');
  if (!scriptDirective) throw new Error('Content-Security-Policy is missing script-src');
  if (scriptDirective.includes("'unsafe-inline'")) {
    throw new Error("script-src must not contain 'unsafe-inline'");
  }
  if (!directives.some((item) => directiveName(item) === 'default-src')) {
    throw new Error('source Content-Security-Policy is missing default-src');
  }
  if (!directives.some((item) => directiveName(item) === 'frame-ancestors')) {
    throw new Error('source Content-Security-Policy is missing frame-ancestors');
  }

  const hashes = new Set();
  for (const source of inlineScripts) {
    if (source) hashes.add(`'sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}'`);
  }
  const sortedHashes = [...hashes].sort();
  const metaDirectives = directives
    .filter((item) => !META_UNSUPPORTED_DIRECTIVES.has(directiveName(item)))
    .map((item) => directiveName(item) === 'script-src'
      ? (sortedHashes.length ? `${item} ${sortedHashes.join(' ')}` : item)
      : item);
  const httpDirectives = directives.filter((item) => !['default-src', 'script-src'].includes(directiveName(item)));
  const headerPolicy = httpDirectives.join('; ');
  const metaPolicy = metaDirectives.join('; ');

  if (/(?:^|;\s*)frame-ancestors\b/i.test(metaPolicy)) {
    throw new Error('frame-ancestors is not supported in a CSP meta policy');
  }
  if (/(?:^|;\s*)(?:report-uri|report-to|sandbox)\b/i.test(metaPolicy)) {
    throw new Error('unsupported directive remains in the CSP meta policy');
  }
  if (/\bscript-src\b[^;]*'unsafe-inline'/i.test(metaPolicy)) {
    throw new Error("meta script-src must not allow 'unsafe-inline'");
  }
  if (/(?:^|;\s*)(?:default-src|script-src)\b/i.test(headerPolicy)) {
    throw new Error('HTTP CSP must leave script enforcement to the early document policy');
  }

  return { headerPolicy, metaPolicy, hashes: sortedHashes };
}

export function addCspMetaToHtml(html, metaPolicy) {
  let output = removeGeneratedMeta(html);
  const existingCspMeta = /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(?:"Content-Security-Policy"|'Content-Security-Policy'|Content-Security-Policy\b))[^>]*\/?>/gi;
  if (existingCspMeta.test(output)) {
    throw new Error('static HTML contains an unmanaged Content-Security-Policy meta element');
  }
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(metaPolicy)}" ${GENERATED_META_MARKER}/>`;
  output = insertMetaAfterCharset(output, metaTag);
  return output;
}

export function rewriteHeaderPolicy(headerFile, headerPolicy) {
  const lines = headerFile.split(/\r?\n/);
  const indexes = lines.flatMap((line, index) => /^\s*Content-Security-Policy\s*:/i.test(line) ? [index] : []);
  if (indexes.length !== 1) {
    throw new Error(`expected exactly one source Content-Security-Policy header; found ${indexes.length}`);
  }
  const index = indexes[0];
  const indent = lines[index].match(/^\s*/)?.[0] ?? '';
  lines[index] = `${indent}Content-Security-Policy: ${headerPolicy}`;
  const tooLong = lines.findIndex((line) => line.length > CLOUDFLARE_MAX_HEADER_LINE_LENGTH);
  if (tooLong >= 0) {
    throw new Error(`Cloudflare Pages _headers line ${tooLong + 1} exceeds ${CLOUDFLARE_MAX_HEADER_LINE_LENGTH} characters`);
  }
  return lines.join('\n');
}

export function generateCspArtifacts(sourceHeaders, html) {
  const sourcePolicy = getSourcePolicy(sourceHeaders);
  const cleanHtml = removeGeneratedMeta(html);
  const inlineScripts = [...cleanHtml.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]);
  const policies = buildCspPolicies(sourcePolicy, inlineScripts);
  return {
    ...policies,
    html: addCspMetaToHtml(cleanHtml, policies.metaPolicy),
  };
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

export async function generate(miniApp = resolve(fileURLToPath(new URL('../apps/mini-app', import.meta.url))), distDir = process.env.FX_E2E_DIST_DIR?.trim() || 'dist') {
  if (!/^[a-zA-Z0-9_-]+$/.test(distDir)) {
    throw new Error('FX_E2E_DIST_DIR must be a simple directory name inside the mini-app workspace');
  }
  const output = join(miniApp, distDir);
  const sourceHeaders = await readFile(join(miniApp, 'public', '_headers'), 'utf8');
  const outputHeadersPath = join(output, '_headers');
  const htmlFiles = (await walk(output)).filter((file) => file.endsWith('.html'));
  if (htmlFiles.length === 0) throw new Error('CSP generation found no static HTML output');

  const generated = await Promise.all(htmlFiles.map(async (file) => {
    const html = await readFile(file, 'utf8');
    return { file, ...generateCspArtifacts(sourceHeaders, html) };
  }));
  const headerPolicies = new Set(generated.map(({ headerPolicy }) => headerPolicy));
  if (headerPolicies.size !== 1) throw new Error('static documents produced inconsistent HTTP CSP policies');
  const headerPolicy = [...headerPolicies][0];
  const outputHeaders = rewriteHeaderPolicy(sourceHeaders, headerPolicy);

  await Promise.all([
    ...generated.map(({ file, html }) => writeFile(file, html, 'utf8')),
    writeFile(outputHeadersPath, outputHeaders, 'utf8'),
  ]);
  const totalHashes = new Set(generated.flatMap(({ hashes }) => hashes));
  const headerLength = outputHeaders.split(/\r?\n/).find((line) => /Content-Security-Policy:/i.test(line)).length;
  console.log(`Generated early per-document CSP meta policies for ${generated.length} HTML files (${totalHashes.size} unique inline-script hashes); one HTTP policy line is ${headerLength}/${CLOUDFLARE_MAX_HEADER_LINE_LENGTH} characters.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generate().catch((error) => {
    console.error(`CSP generation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
