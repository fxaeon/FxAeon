import type { ReactNode } from 'react';
import { CodeBlock, Callout } from '../DocsPrimitives';
import styles from '../Docs.module.css';
import { ExternalLink } from '../ExternalLink';

const source = 'https://github.com/fxaeon/FxAeon/blob/main/';
const upstream = 'https://github.com/AladdinDAO/fx-sdk/tree/53c0b9805a169e75ad375c92c241e1292b66405f';
const upstreamSkill = 'https://github.com/AladdinDAO/fx-sdk-skill/tree/e2c4a6085950a40f238bda1c9159305f6c8acf1f';

const appReadExample = `import { formatUnits, type Address } from 'viem';
import { getFxReadFacade } from '@/lib/fx/readFacade';

// Inside the FxAeon mini-app. No wallet signature is requested.
export async function readFxSaveBalance(userAddress: Address) {
  const { balanceWei, assetsWei } = await getFxReadFacade()
    .getFxSaveBalance({ userAddress });

  return {
    fxSaveShares: formatUnits(balanceWei, 18),
    basePoolShares: assetsWei !== undefined
      ? formatUnits(assetsWei, 18)
      : balanceWei === 0n ? '0' : null,
  };
}`;

const upstreamReadExample = `import { FxSdk } from '@aladdindao/fx-sdk';

// Initialize once, before other SDK consumers in this process.
const sdk = new FxSdk({
  chainId: 1,
  rpcUrl: 'https://ethereum-rpc.publicnode.com',
});

export async function readFxSaveSupply() {
  const config = await sdk.getFxSaveConfig();
  return {
    fxSaveSharesWei: config.totalSupplyWei.toString(),
    basePoolSharesWei: config.totalAssetsWei.toString(),
    cooldownSeconds: config.cooldownPeriodSeconds.toString(),
  };
}`;

export const sdkSections: { id: string; title: string; content: ReactNode }[] = [
  {
    id: 'sdk-overview',
    title: 'Integration overview',
    content: (
      <>
        <p>
          FxAeon integrates <code>@aladdindao/fx-sdk@1.0.5</code> through a locked
          set of 15 methods: four for positions, two for borrowing, two for bridging,
          and seven for fxSAVE. This guide describes that supported integration,
          not every capability in the SDK or f(x) Protocol.
        </p>
        <dl>
          <dt>Upstream public SDK</dt>
          <dd><code>FxSdk</code> reads protocol state and prepares unsigned transactions. It does not sign or broadcast them.</dd>
          <dt>FxAeon application wrappers</dt>
          <dd>The read facade adds deadlines and position validation. Service planners bind SDK output to the reviewed request. The transaction runner handles simulation, explicit wallet approval, receipts, and refresh.</dd>
          <dt>Networks</dt>
          <dd>Positions, Borrow, and fxSAVE use Ethereum, chain ID <code>1</code>. Bridge uses Ethereum and Base, chain ID <code>8453</code>, with distinct source and destination chains.</dd>
        </dl>
        <Callout title="Pinned upstream, reviewed local changes">
          <p>
            FxAeon uses version 1.0.5 with local patches for short-pool accounting,
            exact debt-ratio packing, diagnostic-log removal, chain-bound RPC
            transport, multicall pacing, concurrent pool reads, and protocol-fee
            review metadata. Installing the vanilla package alone does not
            reproduce this integration.
          </p>
        </Callout>
        <p>
          Compare the <ExternalLink href={upstream}>pinned SDK source</ExternalLink>,{' '}
          <ExternalLink href={upstreamSkill}>pinned upstream integration guidance</ExternalLink>,{' '}
          <ExternalLink href={`${source}patches/@aladdindao__fx-sdk@1.0.5.patch`}>local patch</ExternalLink>,
          and <ExternalLink href={`${source}fx-scope.lock.json`}>15-method scope lock</ExternalLink>.
          Upstream authorship does not imply endorsement of FxAeon.
        </p>
        <p>
          Three parts of the patch are tracked in upstream pull requests:{' '}
          <ExternalLink href="https://github.com/AladdinDAO/fx-sdk/pull/15">exact debt-ratio packing (#15)</ExternalLink>,{' '}
          <ExternalLink href="https://github.com/AladdinDAO/fx-sdk/pull/16">concurrent pool reads (#16)</ExternalLink>, and{' '}
          <ExternalLink href="https://github.com/AladdinDAO/fx-sdk/pull/17">no delay after the last multicall batch (#17)</ExternalLink>.
          The short-pool fix is already in the pinned upstream source but not in an
          npm release; the other parts are FxAeon&apos;s own. The{' '}
          <ExternalLink href={`${source}docs/sdk-scope.md#upstream-pull-requests`}>SDK scope</ExternalLink> maps each part.
        </p>
      </>
    ),
  },
  {
    id: 'sdk-setup',
    title: 'Read-only quickstart',
    content: (
      <>
        <p>
          Inside FxAeon, product reads use <code>getFxReadFacade()</code>. The
          underlying Ethereum SDK is a shared instance; route components should
          not construct another instance or import <code>getFxSdk</code> for reads.
        </p>
        <CodeBlock label="FxAeon app wrapper" language="TypeScript" code={appReadExample} />
        <p>
          This example uses the mini-app&apos;s <code>@/</code> import alias. Call it
          with the wallet address you want to read. Errors remain errors; catch them
          in your UI and show unavailable or stale state. <code>null</code> means a
          nonzero balance has no asset conversion available, not zero assets.
        </p>
        <p>
          For a separate project, install <code>@aladdindao/fx-sdk@1.0.5</code>.
          The following uses only the public constructor and read API available
          in that version. It does not include FxAeon&apos;s patches, deadlines, or
          execution safeguards.
        </p>
        <CodeBlock label="Upstream public SDK" language="TypeScript" code={upstreamReadExample} />
        <p>
          The RPC must serve Ethereum. SDK 1.0.5 shares an internal RPC singleton,
          so the first configuration wins. FxAeon keeps its canonical Ethereum
          instance separate from the source-chain transport supplied to bridge
          requests. A successful read is a snapshot, not a guarantee that a later
          transaction will succeed.
        </p>
        <Callout title="Keep units attached to values">
          <p>
            Amounts are integer <code>bigint</code> values in the relevant token&apos;s
            smallest unit. USDC uses 6 decimals; fxUSD, fxSAVE, and fxSP base-pool shares
            use 18. Slippage is a percentage, so <code>0.5</code> means 0.5%, not
            50%. FxAeon accepts values greater than zero and no more than 2% where
            slippage applies, a narrower limit than the upstream API.
          </p>
        </Callout>
        <p>
          Sources: <ExternalLink href={`${source}apps/mini-app/src/lib/fx/sdk.ts`}>SDK adapter</ExternalLink>,{' '}
          <ExternalLink href={`${source}apps/mini-app/src/lib/fx/readFacade.ts`}>read facade</ExternalLink>,{' '}
          <ExternalLink href={`${source}apps/mini-app/src/lib/fxSaveUnits.ts`}>fxSAVE units</ExternalLink>.
        </p>
      </>
    ),
  },
  {
    id: 'sdk-positions',
    title: 'Position methods',
    content: (
      <>
        <p>
          All four methods operate on Ethereum. <code>market</code> is{' '}
          <code>ETH</code> or <code>BTC</code>; <code>type</code> is{' '}
          <code>long</code> or <code>short</code>. Position IDs belong to their pool,
          so retain the market and side alongside the ID.
        </p>
        <h3 id="getPositions" tabIndex={-1}><a href="#getPositions" className={styles.headingLink}><code>getPositions</code><span className={styles.anchorMark} aria-hidden="true">#</span></a></h3>
        <p>Read one wallet&apos;s positions for a market and side. No signing.</p>
        <dl>
          <dt>Input</dt>
          <dd><code>userAddress</code>, <code>market</code>, <code>type</code>.</dd>
          <dt>Output</dt>
          <dd><code>PositionInfo[]</code>: position ID, raw collateral and debt, their token symbols and decimals, current leverage, and LSD leverage.</dd>
          <dt>Refresh</dt>
          <dd>Read on Portfolio/Positions open and after the canonical receipt of a position or Borrow action. The app rejects malformed records; failed groups must not become empty balances.</dd>
        </dl>
        <h3 id="increasePosition" tabIndex={-1}><a href="#increasePosition" className={styles.headingLink}><code>increasePosition</code><span className={styles.anchorMark} aria-hidden="true">#</span></a></h3>
        <p>Prepare a new position or add to an existing one.</p>
        <dl>
          <dt>Input</dt>
          <dd><code>market</code>, <code>type</code>, <code>positionId</code> (0 for new), <code>userAddress</code>, <code>leverage</code>, <code>inputTokenAddress</code>, positive <code>amount</code>, <code>slippage</code>, and optional <code>targets</code>.</dd>
          <dt>Output</dt>
          <dd>Position ID, slippage, and candidate <code>routes</code> with leverage, execution price, collateral/debt details, and ordered <code>txs</code>.</dd>
          <dt>Review and refresh</dt>
          <dd>FxAeon restricts routes to <code>FxRoute</code>. Sign only the selected, reviewed route, including exact approvals when returned. Reload positions after its action receipt is confirmed.</dd>
        </dl>
        <h3 id="reducePosition" tabIndex={-1}><a href="#reducePosition" className={styles.headingLink}><code>reducePosition</code><span className={styles.anchorMark} aria-hidden="true">#</span></a></h3>
        <p>Prepare a partial reduction or full close of an existing position.</p>
        <dl>
          <dt>Input</dt>
          <dd><code>market</code>, <code>type</code>, existing <code>positionId</code>, <code>userAddress</code>, <code>outputTokenAddress</code>, positive <code>amount</code>, <code>slippage</code>, optional <code>isClosePosition</code> and <code>targets</code>.</dd>
          <dt>Output</dt>
          <dd>Position ID, slippage, and candidate routes with ordered transactions and <code>minOut</code>, execution price, leverage, collateral, and debt details.</dd>
          <dt>Amount caveat</dt>
          <dd>Partial reductions use raw collateral for longs, raw debt for BTC shorts, and raw debt converted with the live stETH-per-token rate for ETH shorts. The amount is not universally denominated in the output token. FxAeon derives it from the reviewed position; full close uses the SDK&apos;s close branch.</dd>
          <dt>Refresh</dt>
          <dd>Use the reviewed <code>FxRoute</code>, stop on any failed step, and reload positions after the canonical action receipt.</dd>
        </dl>
        <h3 id="adjustPositionLeverage" tabIndex={-1}><a href="#adjustPositionLeverage" className={styles.headingLink}><code>adjustPositionLeverage</code><span className={styles.anchorMark} aria-hidden="true">#</span></a></h3>
        <p>Prepare a leverage change for an existing position.</p>
        <dl>
          <dt>Input</dt>
          <dd><code>market</code>, <code>type</code>, existing <code>positionId</code>, <code>userAddress</code>, target <code>leverage</code>, <code>slippage</code>, and optional <code>targets</code>.</dd>
          <dt>Output</dt>
          <dd>Position ID, slippage, and candidate routes with leverage, execution price, collateral/debt details, and ordered transactions.</dd>
          <dt>Review and refresh</dt>
          <dd>The app binds the returned leverage to the requested target and permits <code>FxRoute</code> only. Every step requires wallet approval. Reload positions after the canonical action receipt.</dd>
        </dl>
        <Callout title="ETH long collateral is stETH">
          <p>
            The wstETH long pool records collateral in stETH: its PoolManager scales
            supplied wstETH by a rate provider whose rate equals{' '}
            <code>wstETH.stEthPerToken()</code>.
            SDK 1.0.5 labels that figure <code>ETH</code>, so FxAeon shows it as stETH
            without changing it. The open/add quote adds new collateral in wstETH to
            the stETH a position holds, so FxAeon reads <code>stEthPerToken()</code>{' '}
            beside the plan and states the estimate in stETH, rounded down. Signed
            converter minimums stay exact in wstETH.
          </p>
        </Callout>
        <p>
          Token support is market-specific. See the <ExternalLink href={`${source}apps/mini-app/src/lib/fx/service.ts`}>service token and route validation</ExternalLink>{' '}
          and <ExternalLink href={`${source}apps/mini-app/src/app/trade/fxUi.ts`}>position read and reduction handling</ExternalLink>.
        </p>
      </>
    ),
  },
  {
    id: 'sdk-borrow',
    title: 'Borrow methods',
    content: (
      <>
        <p>Both methods use Ethereum long positions only, in the ETH or BTC market.</p>
        <h3 id="depositAndMint" tabIndex={-1}><a href="#depositAndMint" className={styles.headingLink}><code>depositAndMint</code><span className={styles.anchorMark} aria-hidden="true">#</span></a></h3>
        <p>Add collateral, mint fxUSD, or combine both in one planned action.</p>
        <dl>
          <dt>Input</dt>
          <dd><code>market</code>, <code>positionId</code> (0 for new), <code>userAddress</code>, <code>depositTokenAddress</code>, <code>depositAmount</code>, <code>mintAmount</code>. Amounts are nonnegative; they cannot both be zero.</dd>
          <dt>Output</dt>
          <dd>Ordered <code>txs</code> plus position ID, leverage, execution price, collateral, and debt details.</dd>
          <dt>Review and refresh</dt>
          <dd>The deposit is in the chosen collateral token&apos;s units; the mint amount is in fxUSD units. Sign any exact approval, wait for its receipt, then sign the action. Reload positions after its canonical receipt.</dd>
        </dl>
        <h3 id="repayAndWithdraw" tabIndex={-1}><a href="#repayAndWithdraw" className={styles.headingLink}><code>repayAndWithdraw</code><span className={styles.anchorMark} aria-hidden="true">#</span></a></h3>
        <p>Repay fxUSD, withdraw long collateral, or do both.</p>
        <dl>
          <dt>Input</dt>
          <dd><code>market</code>, existing <code>positionId</code>, <code>userAddress</code>, <code>repayAmount</code>, <code>withdrawAmount</code>, <code>withdrawTokenAddress</code>. Amounts are nonnegative; they cannot both be zero.</dd>
          <dt>Output</dt>
          <dd>Ordered <code>txs</code> plus position ID, leverage, execution price, collateral, and debt details.</dd>
          <dt>Review and refresh</dt>
          <dd>Repayment uses fxUSD units; withdrawal uses the chosen collateral token&apos;s units. Any repayment approval is bound to the action&apos;s fee-adjusted amount. A failure stops subsequent steps. Reload positions after the canonical action receipt.</dd>
        </dl>
        <p>
          FxAeon permits ETH, stETH, WETH, or wstETH collateral for the ETH market
          and WBTC for BTC. Neither method accepts a position side or route-target
          parameter. See the <ExternalLink href={`${source}apps/mini-app/src/lib/fx/service.ts`}>Borrow planners</ExternalLink>.
        </p>
      </>
    ),
  },
  {
    id: 'sdk-bridge',
    title: 'Bridge methods',
    content: (
      <>
        <p>
          Bridge connects Ethereum and Base through LayerZero V2 OFT. The app uses
          the canonical <code>fxUSD</code> and <code>fxSAVE</code> keys, or an
          explicitly reviewed advanced OFT. Quotes and sends use the source chain;
          delivery is verified on the destination chain.
        </p>
        <h3 id="getBridgeQuote" tabIndex={-1}><a href="#getBridgeQuote" className={styles.headingLink}><code>getBridgeQuote</code><span className={styles.anchorMark} aria-hidden="true">#</span></a></h3>
        <p>Read the messaging fees for a proposed send. No signing.</p>
        <dl>
          <dt>Input</dt>
          <dd><code>sourceChainId</code>, different <code>destChainId</code>, <code>token</code>, positive <code>amount</code>, <code>recipient</code>, and source RPC configuration. The upstream request makes <code>sourceRpcUrl</code> optional; FxAeon supplies a chain-verified source transport.</dd>
          <dt>Output</dt>
          <dd><code>nativeFee</code> and <code>lzTokenFee</code> as <code>bigint</code>. These are messaging fees, separate from source-chain transaction gas.</dd>
          <dt>Refresh</dt>
          <dd>Requote after any bridge input or source RPC changes. This preview does not reserve a fee; building the transaction obtains a fresh quote.</dd>
        </dl>
        <h3 id="buildBridgeTx" tabIndex={-1}><a href="#buildBridgeTx" className={styles.headingLink}><code>buildBridgeTx</code><span className={styles.anchorMark} aria-hidden="true">#</span></a></h3>
        <p>Prepare the source-chain OFT send and its fee quote.</p>
        <dl>
          <dt>Input</dt>
          <dd>The quote inputs, plus optional <code>refundAddress</code>. Review the actual refund recipient: SDK 1.0.5 falls back to the destination recipient when no valid refund address is supplied.</dd>
          <dt>Output</dt>
          <dd><code>{'{ tx: { to, data, value }, quote }'}</code>. The SDK returns one source send; FxAeon may prepend one exact Ethereum token approval when required.</dd>
          <dt>Review and refresh</dt>
          <dd>Bind the token, amount, destination, recipient, refund address, fees, and minimum delivery amount before signing. Confirm each source step in order. Then verify matching LayerZero GUID events on the destination; a source receipt alone is not delivery.</dd>
        </dl>
        <Callout title="Source confirmed is not destination delivered">
          <p>
            The SDK rounds its minimum-delivery amount down to four decimal
            places. FxAeon retains this bound and the reviewed destination token
            for delivery verification. An unknown destination state stays pending
            or unverified, even after a successful source transaction.
          </p>
        </Callout>
        <p>See the <ExternalLink href={`${source}apps/mini-app/src/lib/fx/bridge.ts`}>bridge planner and contract checks</ExternalLink>.</p>
      </>
    ),
  },
  {
    id: 'sdk-earn',
    title: 'fxSAVE methods',
    content: (
      <>
        <p>
          All seven fxSAVE methods use Ethereum. Keep vault shares, underlying
          fxSP base-pool shares, and redemption outputs distinct. They are different
          assets even when they share an 18-decimal representation.
        </p>
        <h3 id="getFxSaveBalance" tabIndex={-1}><a href="#getFxSaveBalance" className={styles.headingLink}><code>getFxSaveBalance</code><span className={styles.anchorMark} aria-hidden="true">#</span></a></h3>
        <p>Read a wallet&apos;s fxSAVE shares and their underlying-asset conversion.</p>
        <dl>
          <dt>Input</dt><dd><code>userAddress</code>.</dd>
          <dt>Output</dt><dd><code>balanceWei</code> in fxSAVE shares and optional <code>assetsWei</code> in fxSP, the f(x) Stability Pool share (SDK key <code>fxUSDBasePool</code>). A successful zero balance can omit <code>assetsWei</code>.</dd>
          <dt>Refresh</dt><dd>On Earn/Portfolio open and after every fxSAVE write. No signing; a failed read must not be presented as zero.</dd>
        </dl>
        <h3 id="getFxSaveConfig" tabIndex={-1}><a href="#getFxSaveConfig" className={styles.headingLink}><code>getFxSaveConfig</code><span className={styles.anchorMark} aria-hidden="true">#</span></a></h3>
        <p>Read vault totals and live configuration.</p>
        <dl>
          <dt>Input</dt><dd>No arguments required; an empty request object is also accepted.</dd>
          <dt>Output</dt><dd><code>totalSupplyWei</code> (fxSAVE), <code>totalAssetsWei</code> (fxSP), <code>cooldownPeriodSeconds</code>, <code>instantRedeemFeeRatio</code>, <code>expenseRatio</code>, <code>harvesterRatio</code>, and <code>threshold</code>.</dd>
          <dt>Instant-redemption fee precision</dt><dd><code>instantRedeemFeeRatio</code> uses <code>1e18</code> precision: divide by 1e18 for the fractional rate, then multiply by 100 for a percentage. This is separate from the pool/router fee ratios at <code>1e9</code> precision described below.</dd>
          <dt>Refresh</dt><dd>With the other Earn reads. No signing. Read cooldown and fee settings live rather than hardcoding them.</dd>
        </dl>
        <h3 id="getFxSaveRedeemStatus" tabIndex={-1}><a href="#getFxSaveRedeemStatus" className={styles.headingLink}><code>getFxSaveRedeemStatus</code><span className={styles.anchorMark} aria-hidden="true">#</span></a></h3>
        <p>Read a pending queued redemption and its cooldown state.</p>
        <dl>
          <dt>Input</dt><dd><code>userAddress</code>.</dd>
          <dt>Output</dt><dd><code>hasPendingRedeem</code>, <code>pendingSharesWei</code> (fxSP), <code>cooldownPeriodSeconds</code>, <code>redeemableAt</code> (Unix seconds or null), and <code>isCooldownComplete</code>.</dd>
          <dt>Refresh</dt><dd>On Earn open, after withdrawal or claim, and around cooldown completion. No signing. A local countdown alone does not authorize a claim.</dd>
        </dl>
        <h3 id="getFxSaveClaimable" tabIndex={-1}><a href="#getFxSaveClaimable" className={styles.headingLink}><code>getFxSaveClaimable</code><span className={styles.anchorMark} aria-hidden="true">#</span></a></h3>
        <p>Read redemption status plus the expected claim outputs when available.</p>
        <dl>
          <dt>Input</dt><dd><code>userAddress</code>.</dd>
          <dt>Output</dt><dd>The redemption-status fields, plus optional <code>previewReceive</code>: <code>amountYieldOutWei</code> in fxUSD units and <code>amountStableOutWei</code> in USDC units.</dd>
          <dt>Refresh</dt><dd>On Earn open and after withdrawal or claim. A receive preview can exist while cooldown is still running; it is neither claim permission nor a guaranteed final amount.</dd>
        </dl>
        <h3 id="getRedeemTx" tabIndex={-1}><a href="#getRedeemTx" className={styles.headingLink}><code>getRedeemTx</code><span className={styles.anchorMark} aria-hidden="true">#</span></a></h3>
        <p>Prepare the claim for a queued redemption whose cooldown has completed.</p>
        <dl>
          <dt>Input</dt><dd><code>userAddress</code> and optional <code>receiver</code>, defaulting to the wallet.</dd>
          <dt>Output</dt><dd><code>{'{ txs }'}</code>, an ordered transaction array. Despite its name, this is a write plan, not a balance read.</dd>
          <dt>Review and refresh</dt><dd>Require fresh pending/cooldown state and successful simulation, then explicit wallet approval. Reload balance, redemption status, and claimable state after the canonical receipt.</dd>
        </dl>
        <h3 id="depositFxSave" tabIndex={-1}><a href="#depositFxSave" className={styles.headingLink}><code>depositFxSave</code><span className={styles.anchorMark} aria-hidden="true">#</span></a></h3>
        <p>Prepare a deposit of USDC, fxUSD, or fxSP base-pool shares.</p>
        <dl>
          <dt>Input</dt><dd><code>userAddress</code>, <code>tokenIn</code> (<code>usdc</code>, <code>fxUSD</code>, or <code>fxUSDBasePool</code>), positive <code>amount</code> in input-token units, and optional <code>slippage</code>.</dd>
          <dt>Output</dt><dd><code>{'{ txs }'}</code>, with an exact input-token approval when needed before the deposit action.</dd>
          <dt>Deposit slippage limitation</dt><dd>SDK 1.0.5 validates the caller&apos;s <code>slippage</code> value but ignores the chosen tolerance when generating routed USDC/fxUSD deposit calldata. The pinned router forwards the SDK-calculated floor to the base pool, where it is checked in base-pool-share units. It is not a separately enforced final fxSAVE minimum and does not guarantee the caller&apos;s selected deposit tolerance. Direct base-pool deposits have no routed minimum-output floor.</dd>
          <dt>Review and refresh</dt><dd>Review the encoded minimum with its actual units, then sign each step in order. Reload fxSAVE balance and status after the canonical action receipt.</dd>
        </dl>
        <p>
          Implementation references: the <ExternalLink href="https://github.com/AladdinDAO/fx-sdk/blob/53c0b9805a169e75ad375c92c241e1292b66405f/src/core/fxsave.ts#L332-L474">pinned SDK deposit planner</ExternalLink>,{' '}
          <ExternalLink href="https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/periphery/facets/SavingFxUSDFacet.sol#L64-L77">router forwarding</ExternalLink>, and{' '}
          <ExternalLink href="https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/core/FxUSDBasePool.sol#L281-L299">base-pool minimum-share check</ExternalLink>.
        </p>
        <h3 id="withdrawFxSave" tabIndex={-1}><a href="#withdrawFxSave" className={styles.headingLink}><code>withdrawFxSave</code><span className={styles.anchorMark} aria-hidden="true">#</span></a></h3>
        <p>Prepare a queued redemption, an instant exit, or a direct redemption to fxSP base-pool shares.</p>
        <dl>
          <dt>Input</dt><dd><code>userAddress</code>, <code>tokenOut</code> (<code>usdc</code>, <code>fxUSD</code>, or <code>fxUSDBasePool</code>), positive <code>amount</code> in fxSAVE share units, optional <code>instant</code>, and <code>slippage</code> required for an instant exit.</dd>
          <dt>Output</dt><dd><code>{'{ txs }'}</code>, with any required approval before the action. Instant USDC/fxUSD exits apply a fee and slippage. Base-pool-share output is a direct redemption and cannot use <code>instant: true</code> in FxAeon.</dd>
          <dt>Review and refresh</dt><dd>For queued USDC/fxUSD paths, the request queues shares; the later claim can return both fxUSD and USDC. Confirmed queueing does not mean claimed assets. Reload balance, redemption status, and claimable state after each canonical action receipt.</dd>
        </dl>
        <p>
          Sources: <ExternalLink href={`${source}apps/mini-app/src/lib/fxSaveUnits.ts`}>share and asset units</ExternalLink>,{' '}
          <ExternalLink href={`${source}apps/mini-app/src/lib/fx/service.ts`}>fxSAVE planners</ExternalLink>,{' '}
          <ExternalLink href={`${source}apps/mini-app/src/lib/earnState.ts`}>claim availability</ExternalLink>.
        </p>
      </>
    ),
  },
  {
    id: 'sdk-execution',
    title: 'Transaction lifecycle',
    content: (
      <>
        <p>
          A method returning calldata has prepared a plan. FxAeon adds the
          execution boundary in <ExternalLink href={`${source}apps/mini-app/src/lib/fx/service.ts`}>service planners</ExternalLink>,{' '}
          <ExternalLink href={`${source}apps/mini-app/src/lib/fx/validation.ts`}>policy validation</ExternalLink>, and the{' '}
          <ExternalLink href={`${source}apps/mini-app/src/lib/fx/runner.ts`}>transaction runner</ExternalLink>.
        </p>
        <ol>
          <li><strong>Bind the review.</strong> Validate wallet, chain, contract, action, token, amounts, recipients, approvals, economic limits, and conversion-route fingerprints against the user&apos;s request.</li>
          <li><strong>Simulate in order.</strong> Require a successful result for every planned call. Missing, truncated, failed, or unavailable simulation fails closed.</li>
          <li><strong>Ask for each signature.</strong> Send only the reviewed step to the wallet. Exact token or position approval is distinct from the protocol action.</li>
          <li><strong>Wait for each receipt.</strong> Verify the mined transaction matches the reviewed data and remains canonical through the required confirmations before continuing. Rejection, revert, timeout, or nonce drift stops the route.</li>
          <li><strong>Read again.</strong> Refresh authoritative SDK/chain state after the action receipt. If this read fails, show the confirmed transaction and unavailable fresh state separately. A bridge also needs destination-delivery verification.</li>
        </ol>
        <Callout title="A fee rate is not a fee amount">
          <p>
            The local patch retains the pool/router&apos;s supply, withdrawal,
            borrow, and repayment ratios at 1e9 precision. Position actions use
            Router_Diamond&apos;s schedule; Borrow uses FxMintRouter&apos;s.
            Missing metadata is not a zero fee. Gas, conversion costs, and
            slippage remain separate.
          </p>
          <p>
            Only when <code>depositAndMint</code> has borrowing as its sole charged
            leg does FxAeon compute a bound fee amount from the exact mint amount:
            <code> floor(mintAmount × borrowRatio / 1e9)</code>, deducted in fxUSD.
            Other cases show rates until the chargeable amounts can be independently bound.
          </p>
        </Callout>
        <p>
          Simulation reduces avoidable failures; it does not guarantee execution
          or remove protocol, market, bridge, or smart-contract risk. See the{' '}
          <ExternalLink href={`${source}docs/sdk-scope.md`}>scope and fee-review contract</ExternalLink>.
        </p>
      </>
    ),
  },
  {
    id: 'sdk-boundaries',
    title: 'Limits & local patches',
    content: (
      <>
        <p>
          Application reads have a 12-second deadline. Callers must discard
          superseded results when the wallet, network, or request changes. The
          deadline bounds the UI wait; it does not promise cancellation of the
          underlying RPC request. Retained snapshots and local transaction
          journals are recovery aids, not financial truth.
        </p>
        <h3>Position discovery fallback</h3>
        <p>
          FxAeon checks canonical pool ownership counts before relying on SDK
          index results. If IDs are incomplete, app-owned read-only code scans at
          most 4,096 ownership IDs, in batches of 128 with two concurrent batches,
          under the shared deadline. Its 128-entry cache stores candidate IDs;
          ownership and accounting are rechecked on reuse. This fallback is not a
          sixteenth SDK method and introduces no write primitive.
        </p>
        <h3>Position brake reads</h3>
        <p>
          Position rows show how far the market can move before a position reaches
          its pool&apos;s rebalance point. While a row is shown, each position
          refresh makes one multicall of every position&apos;s{' '}
          <code>getPositionDebtRatio</code> and each pool oracle&apos;s{' '}
          <code>getPrice</code>; each pool&apos;s <code>getRebalanceRatios</code>,{' '}
          <code>getLiquidateRatios</code>, and <code>priceOracle</code> are read
          live and cached for 60 seconds. The SDK 1.0.5 bundle contains these pool
          views without exporting them, so FxAeon keeps a minimal ABI checked
          against the bundle. This app-owned code is read-only and signs nothing;
          it is not a sixteenth SDK method.
        </p>
        <h3>Unsupported does not mean implied</h3>
        <p>
          Internal SDK files, aggregator routes, contracts, and experiments are
          not automatically supported product features. Rebalance and liquidation
          distances come from each pool&apos;s live thresholds; global LTV
          thresholds must not be hardcoded as per-position prices. Reviews show
          estimated post-action rebalance and liquidation prices only when their
          required inputs are available, with assumptions behind the info control.
          The inspected scope exposes no
          per-position rebalancing opt-out. New transaction primitives require an
          explicit scope decision.
        </p>
        <p>
          For the full implementation contract, use <ExternalLink href={`${source}docs/sdk-scope.md`}>SDK scope</ExternalLink>{' '}
          alongside the <ExternalLink href={`${source}apps/mini-app/src/lib/fx/types.ts`}>facade and plan types</ExternalLink>,{' '}
          <ExternalLink href={`${source}apps/mini-app/src/app/trade/canonicalPositionReader.ts`}>canonical position reader</ExternalLink>, and{' '}
          <ExternalLink href={`${source}docs/testing.md`}>verification guide</ExternalLink>.
        </p>
      </>
    ),
  },
];
