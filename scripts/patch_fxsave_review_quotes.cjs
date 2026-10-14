// Extend the existing pnpm SDK patch with display-only accepted quote metadata.
// Usage: node scripts/patch_fxsave_review_quotes.cjs <pnpm patch edit directory>
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const directory = process.argv[2];
if (!directory) throw new Error('Pass the SDK edit directory returned by pnpm patch');
for (const bundle of ['index.js', 'index.cjs']) {
  const path = resolve(directory, 'dist', bundle);
  let source = readFileSync(path, 'utf8');
  if (source.includes('// Accepted fxSAVE review quote')) continue;
  const start = source.indexOf('async function depositFxSave(request)');
  const end = source.indexOf('// src/core/index.ts', start);
  if (start < 0 || end < 0) throw new Error('Pinned SDK fxSAVE methods were not found');
  let methods = source.slice(start, end);
  const replace = (before, after) => {
    if (!methods.includes(before)) throw new Error(`Pinned SDK source changed: ${before.slice(0, 80)}`);
    methods = methods.replace(before, after);
  };
  replace('async function depositFxSave(request) {', 'async function depositFxSave(request) {\n  // Accepted fxSAVE review quote: estimates never change transaction terms.\n  const quoteReadAt = Date.now();');
  replace('    return { txs };\n  }\n  const convertInRoute', `    const estimatedOutput = await client.readContract({ address: contracts.FxSave_fxSAVE, abi: SavingFxUSD_default, functionName: "previewDeposit", args: [amount] }).catch(() => undefined);
    return { txs, fxSaveQuote: { kind: "deposit", inputAmount: amount.toString(), tokenAddress: tokenInAddress, actionTo: contracts.FxSave_fxSAVE, actionData: data2, readAt: quoteReadAt, ...(typeof estimatedOutput === "bigint" && estimatedOutput >= 0n ? { estimatedOutput: estimatedOutput.toString() } : {}) } };
  }
  const convertInRoute`);
  replace('  return { txs };\n}\nasync function withdrawFxSave(request) {', `  const estimatedOutput = await client.readContract({ address: contracts.FxSave_fxSAVE, abi: SavingFxUSD_default, functionName: "previewDeposit", args: [basePoolSharesOut] }).catch(() => undefined);
  return { txs, fxSaveQuote: { kind: "deposit", inputAmount: amount.toString(), tokenAddress: tokenInAddress, actionTo: contracts.Router_Diamond, actionData: data, readAt: quoteReadAt, ...(typeof estimatedOutput === "bigint" && estimatedOutput >= 0n ? { estimatedOutput: estimatedOutput.toString() } : {}) } };
}
async function withdrawFxSave(request) {
  const quoteReadAt = Date.now();`);
  replace('    return { txs };\n  }\n  if (!instant)', `    const estimatedOutput = await client.readContract({ address: contracts.FxSave_fxSAVE, abi: SavingFxUSD_default, functionName: "previewRedeem", args: [amount] }).catch(() => undefined);
    return { txs, fxSaveQuote: { kind: "direct-withdraw", inputAmount: amount.toString(), tokenAddress: tokenOutAddress, actionTo: contracts.FxSave_fxSAVE, actionData: data2, readAt: quoteReadAt, ...(typeof estimatedOutput === "bigint" && estimatedOutput >= 0n ? { estimatedOutput: estimatedOutput.toString() } : {}) } };
  }
  if (!instant)`);
  const final = methods.lastIndexOf('  return { txs };');
  if (final < 0) throw new Error('Pinned instant withdrawal result was not found');
  methods = methods.slice(0, final) + `  return { txs, fxSaveQuote: {
    kind: "instant-withdraw", inputAmount: amount.toString(), tokenAddress: tokenOutAddress,
    actionTo: contracts.Router_Diamond, actionData: data, readAt: quoteReadAt,
    estimatedOutput: (tokenXOut + tokenYOut).toString(), instantFeeRatio: instantRedeemFeeRatioRes.toString(),
    grossFxUSD: amountYieldOut.toString(), grossUSDC: amountStableOut.toString(),
    netFxUSD: fxUSDAfterFee.toString(), netUSDC: usdcAfterFee.toString()
  } };` + methods.slice(final + '  return { txs };'.length);
  source = source.slice(0, start) + methods + source.slice(end);
  writeFileSync(path, source);
}
console.log('Preserved accepted fxSAVE quote metadata in both SDK bundles.');
