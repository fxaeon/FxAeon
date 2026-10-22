import type { ReactNode } from 'react';
import DocsIcon from './DocsIcon';
import styles from './Docs.module.css';
import { ExternalLink } from './ExternalLink';

// Materialized content is shared by the articles, legacy guide and local search.
const topicCards = <div className={styles.topicGrid}>
  {[
    { href: '/docs/guide/trade', title: 'Trade & positions', description: 'Open an ETH or BTC position and understand its exposure.', icon: 'CandlestickChart' as const },
    { href: '/docs/guide/earn', title: 'Earn with fxSAVE', description: 'Deposit, choose a withdrawal route, and claim queued assets.', icon: 'Sprout' as const },
    { href: '/docs/guide/borrow', title: 'Borrow fxUSD', description: 'Use collateral to borrow, then manage debt and withdrawals.', icon: 'Landmark' as const },
    { href: '/docs/guide/move', title: 'Move between chains', description: 'Bridge fxUSD or fxSAVE between Ethereum and Base.', icon: 'ArrowLeftRight' as const },
  ].map(({ href, title, description, icon }) => <a key={href} href={href} className={styles.topicCard}>
    <span className={styles.topicIcon}><DocsIcon name={icon} size={19} /><DocsIcon name="ArrowRight" size={15} /></span>
    <strong>{title}</strong><span>{description}</span>
  </a>)}
</div>;

export const productSections: { id: string; title: string; aliases?: string[]; content: ReactNode }[] = [
  { id: 'overview', title: 'Overview', content: <>
    <p>FxAeon is an independent interface for f(x) Protocol. Use the web app or Telegram Mini App to trade ETH and BTC, save with fxSAVE, borrow fxUSD, and bridge supported assets. Your selected wallet confirms each transaction.</p>
    <h3 id="overview-networks">Choose the right network</h3>
    <p>The asset’s name is not enough to identify where it can be used. Check its network before funding an action.</p>
    <div className={styles.referenceTable}><table>
      <thead><tr><th>Action</th><th>Network</th><th>What you use</th></tr></thead>
      <tbody>
        <tr><td>Trade</td><td>Ethereum</td><td>ETH or BTC long and short positions, with the input assets offered by the form.</td></tr>
        <tr><td>Earn</td><td>Ethereum</td><td>fxSAVE deposits, withdrawals, and claims. Deposit assets include fxUSD, USDC, and fxSP.</td></tr>
        <tr><td>Borrow</td><td>Ethereum</td><td>ETH or BTC collateral positions with fxUSD debt.</td></tr>
        <tr><td>Move</td><td>Ethereum ↔ Base</td><td>fxUSD and fxSAVE, with ETH on the source network for fees.</td></tr>
      </tbody>
    </table></div>
    <p>Bridging fxSAVE to Base does not move the Earn vault or make the Ethereum Earn form available on Base. Move it back to Ethereum to use that form.</p>
    <h3 id="overview-assets">Understand the assets</h3>
    <ul>
      <li><strong>fxUSD</strong> is the protocol’s USD-pegged asset. Its market value can differ from one dollar.</li>
      <li><strong>fxSP</strong> is a Stability Pool share. It is distinct from fxUSD and fxSAVE.</li>
      <li><strong>fxSAVE</strong> is an ERC-4626 vault share that compounds Stability Pool rewards. A share balance and its underlying asset value are different quantities.</li>
    </ul>
    <p>The <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/stability-pool">protocol’s Stability Pool documentation</ExternalLink> explains the underlying pool and vault. The <a href="/docs/guide/glossary">glossary</a> explains the names used in FxAeon.</p>
    <h3 id="overview-products">Find your guide</h3>
    {topicCards}
    <p>New to the app? Start with <a href="/docs/guide/getting-started">your first transaction</a>. For the app’s supported SDK methods and local integration, see the <a href="/docs/sdk/overview">developer documentation</a>.</p>
  </> },
  { id: 'getting-started', title: 'Getting started', content: <>
    <p>Start with the wallet, asset, and network you intend to use. You can explore FxAeon before connecting; submitting an action requires a wallet and a fresh review.</p>
    <ol className={styles.steps}>
      <li><h3 id="start-open">Open FxAeon</h3><p>Launch <ExternalLink href="https://t.me/FxAeonBot">@FxAeonBot</ExternalLink> in Telegram or open the <a href="/">web app</a>. Portfolio is the starting point; a product link can open a particular screen directly.</p></li>
      <li><h3 id="start-wallet">Choose your wallet</h3><p>In a browser, choose <strong>Connect wallet</strong> and select your existing wallet. Inside Telegram, sign in through Privy with the available Telegram, email, or wallet option. Check the selected address before adding funds. See <a href="/docs/guide/access">Browser &amp; Telegram</a> for the two connection paths.</p></li>
      <li><h3 id="start-fund">Add funds on the right network</h3><p>Open <a href="/qr">Receive</a> to inspect and copy the complete address or scan its QR code. Send an asset supported by your chosen action on the required network. Keep ETH there for transaction fees: ETH on Base cannot pay an Ethereum fee.</p></li>
      <li><h3 id="start-review">Build and review the action</h3><p>Choose a product, enter an amount, and read the action button if something is missing. Open the review and check amounts, assets, networks, fees, limits, and any recipient. The <a href="/docs/guide/review">review guide</a> explains estimates and exact values.</p></li>
      <li><h3 id="start-confirm">Confirm and follow the result</h3><p>Confirm the request shown by your wallet. An approval can come before the action, so one review may involve several wallet requests. Wait for the result and its receipt link. A submitted bridge also needs destination delivery verification.</p></li>
    </ol>
    <h3 id="start-next">What next?</h3>
    {topicCards}
    <h3 id="start-stuck">If something stops</h3>
    <p>A rejected request is different from a submitted transaction. If you have a transaction hash, open <a href="/history">History</a> and check its status before sending again. If no transaction was submitted, correct the input or connection and start a fresh review. See <a href="/docs/guide/troubleshooting">Troubleshooting</a> for the next step in each state.</p>
  </> },
  { id: 'access', title: 'Browser & Telegram', content: <>
    <p>Both entry points offer the same supported products. The connection experience depends on whether you open FxAeon in a browser or inside Telegram.</p>
    <h3 id="access-telegram">Sign in through Telegram</h3>
    <ol>
      <li>Open <ExternalLink href="https://t.me/FxAeonBot">@FxAeonBot</ExternalLink> and launch its Mini App.</li>
      <li>Use the sign-in option presented by Privy. Telegram sign-in uses your Telegram account; email and existing-wallet options may also be available.</li>
      <li>Check the selected wallet address. Privy supplies a built-in wallet when one is needed.</li>
    </ol>
    <p>Telegram provides native Back navigation, sizing, and haptics. Signing in does not approve a token or submit an onchain action.</p>
    <h3 id="access-browser">Use your browser wallet</h3>
    <ol>
      <li>Open the <a href="/">web app</a> and choose <strong>Connect wallet</strong>.</li>
      <li>Select a wallet and approve its connection request.</li>
      <li>Check the account and network. On a phone, return to the same FxAeon browser tab after your wallet opens.</li>
    </ol>
    <p>Connecting shares the selected public account with the app. Each later approval or transaction still needs its own wallet confirmation. The <a href="/docs/guide/wallets">wallet guide</a> explains those requests.</p>
    <h3 id="access-return">When you come back</h3>
    <p>Check the selected wallet again, especially after changing accounts or networks. Reconnect if the app cannot establish the current session. Saved inputs and recovery records do not authorize signing, and reopening the app does not resend an action.</p>
    <p>If a sign-in or wallet connection is unavailable, use <a href="/docs/guide/troubleshooting#help-wallet">wallet troubleshooting</a>. For what connection and sign-in share, read <a href="/docs/guide/privacy">Privacy &amp; data</a>.</p>
  </> },
  { id: 'wallets', title: 'Wallets & signing', content: <>
    <p>The selected wallet is the sender for an action. Confirm its address before funding it, reviewing a transaction, or continuing a saved draft.</p>
    <h3 id="wallet-account">Check the selected account</h3>
    <p>Open the wallet control or <strong>More → Wallet &amp; account</strong> to inspect the account. Use <a href="/qr">Receive</a> when you need the full address and QR code. Balances and positions are scoped to the selected account and network.</p>
    <p>FxAeon does not ask you to enter a seed phrase or private key. A wallet connection gives access to public account information; it is not permission to move funds.</p>
    <h3 id="wallet-requests">Understand the requests</h3>
    <ul>
      <li><strong>Connection</strong> lets the app use the selected wallet account.</li>
      <li><strong>Token approval</strong> grants a specified contract an allowance to spend a token. It may be required before the action itself.</li>
      <li><strong>Position approval</strong> lets the reviewed contract act on an existing position. Check its position number and contract separately from any token allowance.</li>
      <li><strong>Transaction confirmation</strong> submits the reviewed action to its network.</li>
    </ul>
    <p>FxAeon shows the sequence in the review and names the current request while it waits for your wallet. Confirm only the request you expect. An approval receipt does not prove that the later trade, deposit, loan, or bridge completed.</p>
    <div className={styles.callout}><p>Check the network, contract, asset, amount, recipient where applicable, and allowance in the wallet prompt. Disconnecting a wallet does not revoke an onchain token approval.</p></div>
    <h3 id="wallet-send">Send to another wallet</h3>
    <p>Open <a href="/send">Send</a> to transfer ETH or a supported token shown in the asset picker on Ethereum or Base. Check the asset’s network, enter the amount and complete recipient address, then review the transfer and network fee before confirming in your wallet. Keep ETH on that same network for fees.</p>
    <p>Send keeps the asset on its selected network. To transfer fxUSD or fxSAVE between Ethereum and Base, use <a href="/docs/guide/move">Move</a> instead. A transaction hash means <strong>Submitted</strong>, not confirmed. Follow its status in <a href="/history">History</a> and inspect the network explorer link before trying again.</p>
    <h3 id="wallet-changes">If your account or network changes</h3>
    <p>A review is bound to its signing account and chain. If either changes, return to the intended account and review again. FxAeon does not automatically retry a rejected request or continue with a different sender.</p>
    <p>If an earlier step already submitted, inspect it in <a href="/history">History</a> before restarting. Read <a href="/docs/guide/review">Review &amp; confirmation</a> for changed quotes, sequential requests, and completed results.</p>
  </> },
  { id: 'trade', title: 'Trade & leverage', content: <>
    <p>Trade opens ETH and BTC long or short positions on Ethereum through f(x) Protocol. Leverage increases exposure to price changes and can accelerate losses as well as gains.</p>
    <h3 id="trade-before">Before you start</h3>
    <p>Connect the wallet that will own the position. Hold an input asset offered by the form and ETH on Ethereum for fees. Read <a href="/docs/guide/risks">Risks &amp; rebalancing</a> before choosing leverage.</p>
    <h3 id="trade-steps">Open a position</h3>
    <ol>
      <li><strong>Choose the market and side.</strong> Select ETH or BTC, then Long or Short. A long benefits from a price rise; a short benefits from a fall, before costs and protocol effects.</li>
      <li><strong>Choose the input and amount.</strong> The asset picker lists the supported inputs. Max accounts for the route’s requirements where a spendable maximum can be checked.</li>
      <li><strong>Set leverage.</strong> Stay within the displayed live pool range. The slider illustrates how the chosen position divides between debt and equity.</li>
      <li><strong>Review and confirm.</strong> Check the quoted position size, debt, minimums, execution terms, fees, and available risk estimates. Confirm each requested step in your wallet.</li>
    </ol>
    <p>The ticket’s preview belongs to its current inputs. Changing an input clears the earlier figures. Preparing a review checks and simulates the route again; a preview alone is not a transaction.</p>
    <h3 id="trade-example">How leverage changes your equity</h3>
    <p>A simplified long with $100 of equity, $300 of collateral, and $200 of debt has 3× leverage. A 10% collateral-price rise would leave $130 of equity; a 10% fall would leave $70. This arithmetic excludes fees, funding, and rebalancing. It is not a forecast for a live position.</p>
    <h3 id="trade-rebalancing">Read the position’s risk</h3>
    <p>The review can show estimated rebalance and liquidation prices when the required pool inputs are available. Those thresholds use the pool’s collateral units and can change. Rebalancing reduces exposure; it does not return lost equity or guarantee protection from liquidation. See the <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/rebalancing-the-position-liquidation-brake">protocol’s rebalancing mechanism</ExternalLink>.</p>
    <h3 id="trade-questions">After submission</h3>
    <p>A confirmed result identifies the action and links its transaction. Choose <strong>View position</strong> to inspect the position; it may need a fresh chain read before its current values appear. Later changes belong in <a href="/positions">Positions</a>, with a separate review for each action.</p>
    <p>If the wallet rejects, the quote changes, or a step fails, read the status before retrying. Use <a href="/docs/guide/history">History &amp; recovery</a> when a hash already exists.</p>
  </> },
  { id: 'positions', title: 'Position management', content: <>
    <p>Open <a href="/positions">Positions</a> to inspect and manage the selected wallet’s Ethereum positions. The current chain read supplies the position; a past receipt describes an earlier action.</p>
    <h3 id="positions-read">Read a position</h3>
    <p>A row identifies the market, side, leverage, position number, and estimated value. Its split bar shows debt and equity. When fresh inputs are available, the risk line estimates how far the price can move before rebalancing; a separate threshold concerns liquidation.</p>
    <p>Open the row for collateral, debt, market price, and debt as a share of collateral. Position value is an estimate, not the amount a close will necessarily return. Missing data stays unavailable rather than becoming zero.</p>
    <h3 id="positions-units">Keep the units in view</h3>
    <p>ETH longs use stETH accounting for displayed collateral. Their backing and some signed conversion minimums use wstETH. FxAeon keeps a signed minimum in its original token, with an estimated stETH equivalent where available. BTC longs use WBTC accounting; shorts use fxUSD collateral. Do not compare two figures without checking their units.</p>
    <h3 id="positions-actions">Change a position</h3>
    <ol>
      <li>Open the position you intend to change. On a phone, <strong>All positions</strong> or Back returns to the list; wide screens keep the list beside the selected position.</li>
      <li>Choose <strong>Add</strong>, <strong>Reduce</strong>, <strong>Leverage</strong>, or <strong>Close</strong>. A long also offers <strong>Borrow against this position</strong>.</li>
      <li>Enter the requested inputs. Review the current and estimated resulting position, amounts, costs, and limits before confirming.</li>
    </ol>
    <p>Reducing equity, adding debt, or withdrawing collateral can change the risk margin. A leverage target is a requested outcome; effective leverage can differ after costs and rounding.</p>
    <h3 id="positions-after">After a change</h3>
    <p>FxAeon rereads the position after confirmation. If the read is delayed, keep the receipt as evidence of the completed transaction and wait for current position values. Do not treat the earlier review’s estimates as a verified updated position.</p>
    <p>For borrowing actions, use <a href="/docs/guide/borrow">Borrow fxUSD</a>. For a partial or unclear result, use <a href="/docs/guide/history">History &amp; recovery</a>.</p>
  </> },
  { id: 'earn', title: 'Earn with fxSAVE', content: <>
    <p><a href="/earn">Earn</a> deposits into fxSAVE and manages withdrawals on Ethereum. fxSAVE is a vault share, so the number of shares you hold and the assets they represent are separate values. Its APY is variable.</p>
    <h3 id="earn-before">Before you start</h3>
    <p>Use the wallet that owns your assets and keep ETH on Ethereum for fees. Deposits support fxUSD, USDC, and fxSP. Withdrawals spend fxSAVE shares, not the displayed USD estimate of those shares.</p>
    <h3 id="earn-steps">Deposit into fxSAVE</h3>
    <ol>
      <li>Select <strong>Deposit</strong> and choose fxUSD, USDC, or fxSP in the asset picker.</li>
      <li>Enter an amount within the selected wallet’s available balance.</li>
      <li>Open <strong>Review deposit</strong>. Check the input, estimated fxSAVE output where available, fees, and the route’s actual minimum.</li>
      <li>Confirm any token approval, then the deposit. After confirmation, inspect the receipt and refreshed fxSAVE balance.</li>
    </ol>
    <h3 id="earn-deposit-protection">Understand the deposit minimum</h3>
    <p>For routed fxUSD and USDC deposits, the pinned SDK supplies a fixed floor checked in <strong>fxSP base-pool-share units</strong>. It is not a separately enforced final fxSAVE minimum, and changing a slippage preference does not set a custom deposit tolerance. A direct fxSP deposit has no routed minimum-output floor.</p>
    <p>The review keeps an estimated fxSAVE output separate from a minimum expressed in fxSP. Read the units rather than treating those figures as interchangeable. The <a href="/docs/sdk/earn#depositFxSave">deposit method reference</a> explains the integration limitation.</p>
    <h3 id="earn-withdraw">Choose a withdrawal route</h3>
    <p>Select <strong>Withdraw</strong>, enter the fxSAVE shares to redeem, and choose the receive asset or withdrawal route.</p>
    <div className={styles.referenceTable}><table>
      <thead><tr><th>Route</th><th>Result</th><th>What to check</th></tr></thead>
      <tbody>
        <tr><td>Instant</td><td>Redeem into the selected fxUSD or USDC receive asset without a cooldown.</td><td>The instant-exit fee and conversion minimums. Max slippage changes the applicable conversion limit, not the fee.</td></tr>
        <tr><td>After cooldown</td><td>Request a withdrawal, then submit a separate claim for fxUSD and USDC when ready.</td><td>The current cooldown and claim status. Network fees apply to both request and claim.</td></tr>
        <tr><td>Direct to fxSP</td><td>Redeem fxSAVE directly into Stability Pool shares.</td><td>This is an fxSP payout, not fxUSD or USDC. It has no queued claim or cooldown; network fees still apply.</td></tr>
      </tbody>
    </table></div>
    <p>The form reads the current instant-exit fee and cooldown. Check the actual review rather than assuming an old rate or waiting period. The <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/developers/integrating-fxsave">protocol’s redemption documentation</ExternalLink> describes the underlying withdrawal methods.</p>
    <h3 id="earn-claim">Claim a queued withdrawal</h3>
    <p>A confirmed request queues a redemption; it does not pay out immediately. Earn and Portfolio expose its claim status. When a fresh read says it is ready, open the claim, review it, and confirm the separate transaction. The pending quantity is recorded in fxSP; payout previews are estimates of fxUSD and USDC, not fixed final amounts.</p>
    <h3 id="earn-questions">Understand the return and result</h3>
    <p>The vault compounds Stability Pool rewards. A quoted APY is an annualized display rate, not a guaranteed return or your earnings to date. Read the <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/stability-pool">Stability Pool and fxSAVE explanation</ExternalLink> and <a href="/docs/guide/risks">risk guide</a> before depositing.</p>
    <p>Wait for the confirmed receipt and a refreshed balance or claim status. If a read fails, retry the read; if an action submitted, check <a href="/history">History</a> before sending another request. fxSAVE held on Base must return to Ethereum to use Earn here.</p>
  </> },
  { id: 'borrow', title: 'Borrow fxUSD', content: <>
    <p><a href="/borrow">Borrow</a> uses an ETH or BTC collateral position on Ethereum to borrow fxUSD. You can later add collateral, borrow more, repay debt, or withdraw collateral within the position’s limits.</p>
    <h3 id="borrow-before">Before you start</h3>
    <p>Connect the wallet that will own the position. The form accepts ETH, WETH, stETH, wstETH, or WBTC as offered for the selected market, and ETH on Ethereum pays network fees. Read <a href="/docs/guide/risks">Risks &amp; rebalancing</a> before adding debt.</p>
    <h3 id="borrow-steps">Open a loan</h3>
    <ol>
      <li><strong>Choose collateral.</strong> Select the asset and enter the amount to deposit.</li>
      <li><strong>Enter fxUSD to borrow.</strong> The form estimates the borrowing limit and resulting loan-to-value (LTV). Its usable limit includes a buffer below the pool maximum.</li>
      <li><strong>Review the loan.</strong> Check collateral, net fxUSD received, debt added, resulting LTV, fees, and any available risk estimates.</li>
      <li><strong>Confirm the requests.</strong> A token approval may precede the borrowing transaction. Inspect the confirmed result and refreshed position afterward.</li>
    </ol>
    <h3 id="borrow-questions">Understand the borrowing cost</h3>
    <p>Debt added can exceed the fxUSD delivered to your wallet. The protocol charges opening and closing fees and can apply temporary funding charges. A base rate of zero does not establish the current total borrowing cost. If the current rate is not quoted or unavailable, do not read that as 0%.</p>
    <p><strong>Temporary funding</strong> shows the selected pool’s current annualized rate from f(x)’s contracts. It applies to the whole collateral, not only the borrowed fxUSD; at a lower LTV, the cost is larger relative to your debt. Funding can activate or change while a position is open. The displayed rate is a recent snapshot, not a fixed rate for the loan’s lifetime. The info icon explains the basis and offers an f(x) verification link when the read is unavailable or stale.</p>
    <p>The <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/fxmint-borrowing-fxusd-against-your-btc-and-eth">protocol’s fxMINT documentation</ExternalLink> explains debt, fees, and temporary borrowing costs. Use the current review for the action’s amounts.</p>
    <h3 id="borrow-manage">Manage collateral and debt</h3>
    <p>Under <strong>Your positions</strong>, select the loan and choose <strong>Add collateral</strong>, <strong>Borrow more</strong>, <strong>Repay debt</strong>, or <strong>Withdraw collateral</strong>. Where offered, combine repayment with withdrawal or collateral with borrowing. A long in Positions can open Borrow through <strong>Borrow against this position</strong>.</p>
    <p>Borrowing more or withdrawing collateral can increase LTV and reduce the risk margin. Adding collateral or repaying can lower it. The review compares current and estimated resulting terms for an existing position.</p>
    <h3 id="borrow-after">After confirmation</h3>
    <p>The receipt establishes the confirmed transaction; a subsequent chain read supplies current debt and collateral. Wait for that read before treating an estimated outcome as the updated position. If a request fails after an approval succeeds, check <a href="/docs/guide/history">History &amp; recovery</a> before starting over.</p>
  </> },
  { id: 'move', title: 'Move between chains', content: <>
    <p><a href="/move">Move</a> bridges fxUSD and fxSAVE between Ethereum and Base through the f(x) LayerZero route. Source confirmation and destination delivery are separate events.</p>
    <h3 id="move-before">Before you start</h3>
    <p>Hold the selected asset and enough ETH for fees on the source network. Verify the destination network and recipient. A token’s balance on one chain does not pay for an action on the other.</p>
    <h3 id="move-steps">Send assets to the other chain</h3>
    <ol>
      <li><strong>Choose the direction.</strong> The Send and Receive panels name the two networks. Use the direction control between them to reverse the route.</li>
      <li><strong>Choose asset and amount.</strong> Select fxUSD or fxSAVE. A fresh preview can show an estimated receive amount, minimum received, and bridge fee. Use <strong>Refresh quote</strong> if it expires.</li>
      <li><strong>Check the recipient.</strong> It defaults to <strong>Your wallet</strong>. Choose <strong>Change</strong> to enter another <strong>Destination wallet</strong>, or <strong>Use your wallet</strong> to restore the default.</li>
      <li><strong>Review and send.</strong> Check both networks, token identity, full recipient, amount, minimum, bridge fee, and network fee. Confirm any required token approval, then the send.</li>
    </ol>
    <h3 id="move-delivery">Follow delivery</h3>
    <p>A confirmed source transaction means the transfer started; it does not prove the destination wallet received funds. FxAeon tracks matching bridge events and shows destination delivery separately. Sent and received amounts are reported from verified events when available, rather than copied from the earlier quote.</p>
    <p>If delivery is unverified or delayed, keep the transaction record and inspect its receipt links in <a href="/history">History</a>. Do not repeat the transfer just because the source confirmed before delivery appeared. See <a href="/docs/guide/troubleshooting#help-delivery">Sent but not received</a>.</p>
    <h3 id="move-questions">Custom bridge contracts</h3>
    <p>The settings gear contains <strong>Expert mode · custom contracts</strong>. It accepts source and destination OFT contracts and, where needed, an Ethereum approval token for adapter routes. Use it only when you can verify those contracts and their connection. Passing the form’s checks does not make an arbitrary token trusted or guarantee delivery.</p>
    <p>The supported default routes need no custom addresses. For exact SDK constraints, see <a href="/docs/sdk/bridge">Bridge methods</a>. Bridging fxSAVE to Base does not enable Earn withdrawals on Base in this app.</p>
  </> },
  { id: 'review', title: 'Review & confirmation', content: <>
    <p>A review is the point where you check what the current action will ask your wallet to do. Preparing or opening it does not submit a transaction. Confirm only after the amounts and terms match your intent.</p>
    <h3 id="review-amounts">Read the amount first</h3>
    <p>The main rows show the assets and amounts at stake. Their secondary line identifies the role—such as Deposit, Estimated, or Received—and the relevant network or USD estimate. An expected output, a minimum, and debt added answer different questions.</p>
    <ul>
      <li><strong>Estimated</strong> describes a quote or projected result. It can change before execution.</li>
      <li><strong>Minimum received</strong> is a quoted limit where that route enforces one. It is not the expected payout.</li>
      <li><strong>Debt added</strong> is the increase in debt, which may exceed net tokens received.</li>
    </ul>
    <p>Select a shortened amount or expandable value to inspect its full precision. Read its token unit. For example, an fxSP deposit floor is not a final fxSAVE minimum.</p>
    <h3 id="review-terms">Check terms and exact evidence</h3>
    <p>Fees, slippage, price impact, LTV, and available risk estimates appear beside their values. The small circled info controls explain terms: tap them, focus them with the keyboard, or hover with a pointer. Escape or an outside tap dismisses the explanation. Definitions do not replace the visible signing terms.</p>
    <p><strong>Execution details</strong> holds the route, contracts, wallet requests, and other exact evidence. Use it to inspect the action without mistaking technical data for an additional fee or a second output. An unavailable term means its value has not been established.</p>
    <h3 id="review-requests">Confirm sequential wallet requests</h3>
    <ol>
      <li>Check the selected account, network, amounts, recipient where applicable, limits, and fees.</li>
      <li>Choose the review’s action. If a token or position approval is needed, the wallet can ask for it first.</li>
      <li>Wait for the app to verify that step. Confirm the next requested transaction only when its description matches the review.</li>
    </ol>
    <p>If the quote expires or signing-relevant terms change, inspect the updated review and choose the action again. If you reject a request or change accounts, FxAeon does not resend automatically. Earlier confirmed steps still matter even when a later step fails.</p>
    <h3 id="review-result">Distinguish a quote from a receipt</h3>
    <p>Submitted means a transaction hash was returned. Confirmed means its matching receipt was verified. Completed token movements come from verified receipts; reviewed amounts remain separately labelled when retained for comparison. Position values can still be refreshing after confirmation. A bridge additionally needs verified destination delivery.</p>
    <p>USD amounts use current display prices. A dollar figure shown now beside a receipt is not a price recorded at the time of that transaction. Exact token amounts and network fees are the evidence to inspect.</p>
    <p>Use <a href="/docs/guide/history">History &amp; recovery</a> for a saved or partially completed action, and <a href="/docs/guide/fees">Fees &amp; slippage</a> for cost and limit definitions.</p>
  </> },
  { id: 'fees', title: 'Fees & slippage', content: <>
    <p>Separate the cost of the protocol action from the cost of putting it onchain. Review each in its own unit; a USD estimate is a display aid.</p>
    <h3 id="fees-types">Separate the costs</h3>
    <ul>
      <li><strong>Network fee</strong> pays for transaction execution. Both supported networks use ETH for these fees. Base can include L1 data and operator fees.</li>
      <li><strong>f(x) fee</strong> is the protocol’s charge for the action, such as opening, closing, or instant redemption.</li>
      <li><strong>Bridge fee</strong> pays for the cross-chain messaging route and is quoted separately from source transaction gas.</li>
      <li><strong>Funding or borrowing cost</strong> can affect positions over time. A missing current rate is not a zero rate.</li>
    </ul>
    <p>Protocol rates can change through governance. Read the <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/fees">official fee categories</ExternalLink> and use the current review for your action’s quoted amounts. A failed onchain transaction can still incur a network fee.</p>
    <h3 id="fees-gas">Keep enough ETH on the source network</h3>
    <p>A network fee marked <strong>max</strong> is a reviewed upper amount rather than the amount already charged. Inspect the exact native fee value as well as its USD estimate. You also need any ETH sent by the action itself and, for Move, its bridge fee.</p>
    <p>If ETH is short, the review identifies the network and the amount to add when it can establish one. <strong>Receive ETH</strong> opens the funding path. Add funds on that network and prepare a fresh review. A verified receipt supplies the actual charged network fee after execution.</p>
    <h3 id="fees-slippage">Set the applicable slippage limit</h3>
    <p>Max slippage is the adverse price movement you permit between quote and execution. A lower tolerance can cause a transaction to revert; a higher tolerance permits a less favorable execution. It is different from the protocol fee and price impact.</p>
    <p>The gear on Trade, position actions, and applicable instant fxSAVE withdrawals offers 0.1%, 0.5%, 1%, 2%, or a custom value greater than zero and up to 2%. Routed fxSAVE deposits use the <a href="/docs/guide/earn#earn-deposit-protection">SDK’s fixed base-pool-share floor</a>; the chosen slippage preference does not create a final fxSAVE minimum. Borrow and Move retain their action-specific limits.</p>
    <h3 id="fees-settings">Wallet and saved settings</h3>
    <p>Network speed applies to the built-in wallet. An external wallet controls its own gas settings, so a form with only gas settings can hide the gear for that wallet. Settings are saved on this device and update open forms. Always read the wallet prompt and the current review before confirming.</p>
    <p>See <a href="/docs/guide/review">Review &amp; confirmation</a> for exact fees, changed terms, and receipts.</p>
  </> },
  { id: 'risks', title: 'Risks & rebalancing', content: <>
    <p>FxAeon’s checks help match a transaction to its review. They do not remove the economic, contract, token, wallet, bridge, or network risks of the underlying action.</p>
    <h3 id="risks-leverage">Leverage and collateral prices</h3>
    <p>Leverage increases sensitivity to price changes. A falling collateral value can raise a long or borrowing position’s LTV; a price rise can hurt a short. Fees, funding, and position changes also affect the margin. Use the current pool and position data rather than a fixed percentage from an example.</p>
    <h3 id="risks-rebalancing">Rebalancing is distinct from liquidation</h3>
    <p>At the rebalance threshold, protocol operations can reduce a position’s debt and collateral to bring leverage back toward its permitted range. This changes the exposure left in the position. It does not restore equity already lost, and liquidation can still occur.</p>
    <p>FxAeon’s rebalance and liquidation prices are estimates where fresh inputs are available. They use the pool’s accounting asset, which may differ from the wallet token you deposited. Read the <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/rebalancing-the-position-liquidation-brake">rebalancing mechanism</ExternalLink> and <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/risk-management/risk-parameters">current protocol risk parameters</ExternalLink>.</p>
    <h3 id="risks-protocol">Protocol-wide conditions</h3>
    <p>The protocol’s risk framework includes rebalancing, liquidation, reserves, bad-debt redistribution, and recapitalization. If reserves cannot cover bad debt, losses can reach other leveraged positions. Severe insolvency can restrict operations or halt new positions. These mechanisms do not guarantee principal.</p>
    <p>The <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/risk-management/risk-framework">official risk framework</ExternalLink> is the source for those system-wide rules.</p>
    <h3 id="risks-other-assets">Vaults, stablecoins, and bridges</h3>
    <p>fxUSD’s peg and fxSAVE’s variable yield are not fixed-dollar guarantees. Vault shares depend on underlying assets and protocol operations. A cross-chain transfer also depends on its bridge and destination chain; source confirmation alone is not delivery.</p>
    <h3 id="risks-checks">Use the information available</h3>
    <ul>
      <li>Inspect the current position, token units, fees, and limits before signing.</li>
      <li>Treat stale or unavailable data as unknown, rather than assuming a safe value.</li>
      <li>Check the selected wallet, networks, recipient, and contract in the review and wallet prompt.</li>
      <li>Follow a submitted transaction’s receipt and, for Move, destination delivery before considering another send.</li>
    </ul>
    <p>See <a href="/docs/guide/positions">Position management</a>, <a href="/docs/guide/earn">Earn with fxSAVE</a>, and <a href="/docs/guide/move">Move between chains</a> for the relevant workflow.</p>
  </> },
  { id: 'glossary', title: 'Glossary', content: <>
    <p>These definitions describe the terms used in FxAeon. Product guides and the current transaction review supply the action-specific context.</p>
    <h3 id="glossary-assets">Assets and shares</h3>
    <dl>
      <dt>fxUSD</dt><dd>The protocol’s USD-pegged token. Its market price can differ from one dollar.</dd>
      <dt>fxSP</dt><dd>A share of the f(x) Stability Pool. The app’s SDK also calls it a base-pool share.</dd>
      <dt>fxSAVE</dt><dd>A share of the auto-compounding savings vault. Share quantity and underlying asset value are different.</dd>
      <dt>stETH and wstETH</dt><dd>Related staking assets with different token units. FxAeon displays ETH-long collateral in stETH accounting while some signed limits remain in wstETH.</dd>
      <dt>WBTC</dt><dd>The wrapped BTC token used for the supported BTC collateral market on Ethereum.</dd>
    </dl>
    <h3 id="glossary-positions">Positions and risk</h3>
    <dl>
      <dt>Collateral</dt><dd>The assets backing a position’s debt.</dd>
      <dt>Debt</dt><dd>The obligation recorded for the position. Debt added can exceed the net tokens received.</dd>
      <dt>Equity or position value</dt><dd>The estimated value remaining after debt, in the position’s valuation context. It is not a close quote.</dd>
      <dt>Leverage</dt><dd>Exposure relative to equity. A requested target and quoted effective leverage can differ after costs.</dd>
      <dt>Loan-to-value (LTV)</dt><dd>Debt divided by collateral value, expressed as a percentage.</dd>
      <dt>Rebalancing</dt><dd>A protocol operation that can reduce debt and collateral at a risk threshold. It is distinct from liquidation.</dd>
      <dt>Liquidation</dt><dd>A protocol process for handling a position under its liquidation conditions, which can cause losses.</dd>
    </dl>
    <h3 id="glossary-transactions">Quotes and transactions</h3>
    <dl>
      <dt>Slippage</dt><dd>The adverse price movement permitted by the applicable execution limit.</dd>
      <dt>Price impact</dt><dd>The estimated effect of an action on its execution price, separate from slippage tolerance.</dd>
      <dt>Minimum received</dt><dd>A quoted lower limit where the route enforces one, rather than the expected output.</dd>
      <dt>Approval</dt><dd>Permission for a contract to act on an asset. A token approval grants an allowance; a position approval concerns the selected position.</dd>
      <dt>Network fee or gas</dt><dd>The cost of executing a transaction on its chain, paid in ETH on the supported networks.</dd>
      <dt>Receipt</dt><dd>The chain’s record of an included transaction and its execution outcome.</dd>
      <dt>APY</dt><dd>An annualized estimate of variable yield, not a guaranteed return or earnings to date.</dd>
      <dt>Cooldown</dt><dd>The waiting period before a queued redemption can become claimable.</dd>
      <dt>OFT</dt><dd>A LayerZero token interface used by the bridge. Custom OFT addresses still need independent verification.</dd>
    </dl>
    <p>Continue with <a href="/docs/guide/review">Review &amp; confirmation</a> or <a href="/docs/guide/risks">Risks &amp; rebalancing</a>.</p>
  </> },
  { id: 'history', title: 'History & recovery', aliases: ['recovery'], content: <>
    <p><a href="/history">History</a> helps you follow submitted transactions and return to saved actions on this device. It is not a complete blockchain history, and it does not resend transactions automatically.</p>
    <h3 id="history-drafts">Continue a saved draft</h3>
    <p>A draft can be saved before the wallet returns a transaction hash. It does not prove a prompt opened or a transaction was submitted. <strong>Continue</strong> restores the saved form into a fresh review for the matching wallet and network; the app rebuilds and checks the route rather than reusing an executable transaction.</p>
    <p>Check your wallet’s activity as well. If it already shows a submitted transaction, resolve that transaction before starting another action from the draft.</p>
    <h3 id="history-submitted">Inspect a submitted transaction</h3>
    <ol>
      <li>Open the entry for the action and check its wallet, chain, and transaction hash.</li>
      <li>Follow the receipt link to inspect the corresponding network record.</li>
      <li>Read whether the transaction is pending, confirmed, failed, or needs attention. A bridge additionally tracks destination delivery.</li>
    </ol>
    <p>Confirmed action amounts come from verified evidence. Dollar values beside those amounts can use current prices; they are not a record of the execution-time exchange rate.</p>
    <h3 id="history-partial">If only part of the action completed</h3>
    <p>An approval may succeed before a later action fails or is rejected. Read which steps have hashes and which have confirmed receipts. Do not mistake an approval for the intended action, or an unverified bridge delivery for a failed source send.</p>
    <p>Return to the product and prepare a fresh review only after understanding the earlier transaction’s status. Reconnecting, refreshing, or reopening FxAeon does not by itself submit another transaction.</p>
    <h3 id="history-storage">Know what the record can restore</h3>
    <p>Recovery records depend on this browser’s site data. Another device or cleared storage may not contain them, while submitted transactions remain onchain. Keep important transaction hashes. See <a href="/docs/guide/privacy">Privacy &amp; data</a> for local storage and <a href="/docs/guide/troubleshooting">Troubleshooting</a> for an unclear status.</p>
  </> },
  { id: 'privacy', title: 'Privacy & risks', content: <>
    <p>Read <a href="/privacy.html">How FxAeon handles your data</a> for the privacy disclosure. This guide explains the practical difference between local records, wallet information, and public chain data.</p>
    <h3 id="privacy-device">Records on this device</h3>
    <p>FxAeon uses browser storage for transaction settings, wallet preferences, display caches, draft inputs, and recovery records. They help restore the workspace; they do not authorize a transaction. Clearing site data can remove those local records.</p>
    <h3 id="privacy-wallet">Wallets and sign-in</h3>
    <p>Connecting a wallet shares its public address and selected network with the app. Privy handles built-in wallet and sign-in services; the chosen method can share email or Telegram account information with Privy. FxAeon does not ask you to enter a seed phrase or private key.</p>
    <p>Disconnecting stops use of the selected wallet. It does not erase blockchain records or revoke token approvals already granted onchain.</p>
    <h3 id="privacy-services">Public records and external services</h3>
    <p>Reading balances, positions, prices, and transaction status involves blockchain and data providers. Requests can include public wallet addresses and transaction hashes. Hosting and service providers also receive ordinary connection information when your browser contacts them.</p>
    <p>Transactions on public blockchains are publicly visible. A local History record is separate from that public record; deleting one does not delete the other. Consult the privacy disclosure and the policies of the wallet, authentication, and network services you use.</p>
    <h3 id="privacy-safety">Protect the action you sign</h3>
    <p>Check the full address, network, asset, contract, amount, and recipient when relevant. Read <a href="/docs/guide/wallets">Wallets &amp; signing</a> for requests and allowances. For economic and protocol risks, use the separate <a href="/docs/guide/risks">Risks &amp; rebalancing</a> guide.</p>
  </> },
  { id: 'troubleshooting', title: 'Troubleshooting', content: <>
    <p>Start with the status shown by the app. Establish whether a transaction was submitted before trying the action again.</p>
    <h3 id="help-wallet">Wallet is not available</h3>
    <p>Wait for connection to finish. If the app reports a timeout, reload or reopen the Mini App through the Telegram bot. In a browser, reconnect the intended wallet and return to the same FxAeon tab after approving the connection. Check the account and network before continuing.</p>
    <h3 id="help-disabled">The action button is disabled</h3>
    <p>The button names the missing requirement, such as an amount, balance, or valid address. Check that the amount uses the selected token’s precision and fits the available balance or position limit. Keep leverage and slippage within the displayed bounds. An unavailable balance is unknown, not zero.</p>
    <h3 id="help-data">Balances, prices, or risk estimates are unavailable</h3>
    <p>Retry or refresh the relevant read and check your connection. A display price is separate from an executable quote, and a missing risk estimate is not proof that a position is safe. Do not substitute an earlier wallet’s values or assume a loading placeholder is an amount.</p>
    <h3 id="help-gas">The review asks for more ETH</h3>
    <p>Add ETH on the network named by the review. Use <strong>Receive ETH</strong> where offered, then prepare a fresh review. Move also needs its quoted bridge fee on the source network. Assets on Base cannot cover an Ethereum gas shortfall.</p>
    <h3 id="help-quote">The quote expired or changed</h3>
    <p>Refresh the quote or return to a fresh review. Read the updated output, limits, and fees before choosing the action again. Changing an amount, asset, recipient, wallet, or network can invalidate the earlier quote.</p>
    <h3 id="help-receipt">The action stopped or a receipt is unclear</h3>
    <p>Check the wallet’s activity and the <a href="/history">History</a> entry. A rejection, failed transaction, timeout, or receipt mismatch can stop later requests. If a hash exists, inspect it on its network before submitting again. Earlier approved or confirmed steps do not disappear when a later step stops.</p>
    <h3 id="help-delivery">Sent but not received</h3>
    <p>A source confirmation can precede bridge delivery. Keep the History entry and inspect both network receipt links where available. If destination delivery remains unverified, do not repeat the transfer. See <a href="/docs/guide/move#move-delivery">Follow delivery</a>.</p>
    <h3 id="help-claim">A withdrawal is not ready to claim</h3>
    <p>Read Earn’s live claim status and the available time. A queued request is not an immediate payout, and a fresh read is needed before claim review. Direct redemption to fxSP is a different route with no queued claim.</p>
    <h3 id="help-support">Find help with a specific transaction</h3>
    <p>Keep the network, public wallet address, transaction hash, and displayed status. Reach FxAeon through <ExternalLink href="https://x.com/FxAeonxyz">@FxAeonxyz on X</ExternalLink>. Never share a seed phrase or private key.</p>
  </> },
];
