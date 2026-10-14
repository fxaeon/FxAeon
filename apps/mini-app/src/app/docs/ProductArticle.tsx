import type { ReactNode } from 'react';
import { ArrowRight, ArrowLeftRight, CandlestickChart, Landmark, Sprout } from 'lucide-react';
import { DocSection } from './DocsPrimitives';
import styles from './Docs.module.css';
import { ExternalLink } from './ExternalLink';

// Keep the card tree materialized so the content index sees its visible copy.
const topicCards = <div className={styles.topicGrid}>
    {[
      { href: '/docs/guide/trade', title: 'Trade & positions', description: 'Understand ETH and BTC longs, shorts, and leverage.', icon: CandlestickChart },
      { href: '/docs/guide/earn', title: 'Earn with fxSAVE', description: 'Deposit, withdraw, and follow a queued redemption.', icon: Sprout },
      { href: '/docs/guide/borrow', title: 'Borrow fxUSD', description: 'Manage collateral, debt, and repayments.', icon: Landmark },
      { href: '/docs/guide/move', title: 'Move between chains', description: 'Bridge supported assets between Ethereum and Base.', icon: ArrowLeftRight },
    ].map(({ href, title, description, icon: Icon }) => <a key={href} href={href} className={styles.topicCard}>
      <span className={styles.topicIcon}><Icon size={19} strokeWidth={1.5} aria-hidden="true" /><ArrowRight size={15} aria-hidden="true" /></span>
      <strong>{title}</strong><span>{description}</span>
    </a>)}
  </div>;

export const productSections: { id: string; title: string; aliases?: string[]; content: ReactNode }[] = [
  { id: 'overview', title: 'Overview', content: <>
<p>Trade ETH and BTC, earn with fxSAVE, and borrow fxUSD on Ethereum. Move fxUSD and fxSAVE between Ethereum and Base.</p>
              <p>FxAeon is an independent interface built on the f(x) SDK. These guides cover the actions available here, with every transaction approved in your wallet. For protocol design and contract details, read the <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs">f(x) protocol docs</ExternalLink>.</p>
              {topicCards}
              <h3 id="overview-assets">Understand the assets</h3>
              <ul><li><strong>fxUSD</strong> is the protocol’s USD-pegged asset. Its market price can move away from one dollar.</li><li><strong>fxSP</strong> represents a share of the Stability Pool.</li><li><strong>fxSAVE</strong> is a tokenized vault that compounds Stability Pool rewards. Holding a vault share is different from holding a fixed amount of dollars.</li></ul>
              <p>See the protocol’s <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/stability-pool">Stability Pool and fxSAVE explanation</ExternalLink> for the underlying design.</p>
  </> },
  { id: 'getting-started', title: 'Getting started', content: <>
              <ol className={styles.steps}>
                <li><h3 id="start-open">Open FxAeon</h3><p>Open <a href="https://t.me/FxAeonBot" target="_blank" rel="noopener noreferrer">@FxAeonBot</a> in Telegram and launch the mini app, or open the <a href="/">web app</a>. Both start on Portfolio.</p></li>
                <li><h3 id="start-wallet">Choose your wallet</h3><p>In Telegram, sign in seamlessly with your Telegram account. <ExternalLink href="https://privy.io">Privy</ExternalLink> provides the built-in wallet when you need one. In a browser, choose <strong>Connect wallet</strong> and select your existing wallet. Check the selected address before continuing.</p></li>
                <li><h3 id="start-fund">Add funds on the right network</h3><p>Choose <a href="/qr">Receive</a> to see your wallet address and QR code. Send the asset you plan to use on the network the action requires. Trade, Earn, and Borrow run on Ethereum; Move connects Ethereum and Base.</p><div className={styles.callout}><p>Keep ETH on the network you are using for gas. A token balance on Base cannot pay an Ethereum transaction fee. Check the token, address, and network in the sending wallet before sending.</p></div></li>
                <li><h3 id="start-review">Build and review the action</h3><p>Choose Trade, Earn, Borrow, or Move and enter an amount. Review the network, asset, amount, output, recipient where applicable, and fees. The app checks the route before it asks your wallet to sign.</p></li>
                <li><h3 id="start-confirm">Confirm and follow the result</h3><p>Confirm each requested step in your wallet. A token approval may come before the action itself. FxAeon verifies the matching receipt before continuing, and <a href="/history">History</a> records the submitted transaction on this device.</p></li>
              </ol>
              <h3 id="start-next">What next?</h3>
              {topicCards}
              <h3 id="start-stuck">If something stops</h3>
              <p>Read the status before retrying. A rejected wallet request, expired quote, or network change can require a fresh review. If a transaction already has a hash, check <a href="/docs/guide/history">History & recovery</a> before submitting again.</p>
  </> },
  { id: 'access', title: 'Browser & Telegram', content: <>
<h3 id="access-telegram">Sign in through Telegram</h3>
<p>The web app and Telegram Mini App offer the same actions. Telegram adds native sizing, haptics, and navigation.</p>
              <p>In your browser, use Connect wallet to choose an existing wallet. Open the Mini App from Telegram to sign in seamlessly with your Telegram account through Privy. A wallet is created if you need one; email sign-in and existing wallets are also available. Each transaction requires confirmation in your selected wallet.</p>
              <p>A Telegram link to one screen, such as Open Trade in Telegram on fxaeon.xyz, opens that screen directly. Telegram’s Back button then returns to where the app opened.</p>
              <h3 id="access-browser">Use your browser wallet</h3>
              <p>Choose Connect wallet, select the wallet you use, and approve its connection request. Connecting lets FxAeon read the selected account; it does not send a transaction. On mobile, return to the same browser tab after your wallet opens.</p>
              <h3 id="access-return">When you come back</h3>
              <p>Check the selected account and network again. If you switch accounts or the app cannot confirm the current connection, reconnect before reviewing another action. Saved form values are never permission to sign.</p>
  </> },
  { id: 'wallets', title: 'Wallets & signing', content: <>
<h3 id="wallet-account">Check the selected account</h3>
<p>Your connected wallet supplies the sender. FxAeon does not receive or store private keys.</p>
              <p>Open the wallet control to check your address, or use More → Settings to change wallets. Balances and positions belong to the selected account and network.</p>
              <h3 id="wallet-requests">Understand the requests</h3>
              <p>A transaction may need more than one approval. The review says so before the first wallet request, for example “Two wallet requests: approve fxUSD, then confirm.” If its terms change before signing, review the updated details and choose the action again.</p>
              <div className={styles.callout}><p><strong>Before approval:</strong> confirm the address, network, recipient, amount, contract, and any approval request in your wallet.</p></div>
              <h3 id="wallet-changes">If your account or network changes</h3>
              <p>FxAeon stops a review when the signing account or chain no longer matches it. Return to the app, select the intended wallet, and review the updated action. It does not retry a signature or send automatically.</p>
  </> },
  { id: 'trade', title: 'Trade & leverage', content: <>
<p>Trade supports ETH and BTC long and short positions on Ethereum. Choose an input asset, amount, side, and leverage. The market panel shows the current price and 1H, 1D, 7D, and 30D charts; rest a finger or pointer on the chart to read an earlier price.</p>
              <p>The leverage slider shows what your choice means: how much of the position is debt (fxUSD minted for a long, wstETH or WBTC borrowed for a short) and how much is yours. With your wallet connected and an amount entered, the ticket estimates the position it would open: its collateral, its debt, and the protocol fee rate. These are the review’s own figures, marked ≈, and they clear as soon as you change an input.</p>
              <p>Action details show the transaction steps, minimum output, approvals, and slippage. Before opening your wallet, the app checks and simulates the displayed action. If the preview expires or signing-relevant details change, review the updated details and choose the action again.</p>
              <p>When the trade confirms, its result is named for what happened, such as “Opened ETH Long”, and shows the new position as its row. View position opens it.</p>
              <h3 id="trade-steps">Trade in three steps</h3>
              <ol>
                <li><strong>Pick a direction.</strong> Long gains when the price rises; short gains when it falls. Positions settle on f(x) Protocol on Ethereum.</li>
                <li><strong>Choose leverage.</strong> Leverage multiplies exposure within the pool’s live range. More leverage means more of the position is debt, which brings it closer to the point where the protocol rebalances it.</li>
                <li><strong>Review, then sign.</strong> FxAeon simulates the exact route and shows each step, fee, and minimum output before your wallet opens.</li>
              </ol>
              <h3 id="trade-example">How leverage changes your equity</h3>
              <p>Suppose $100 of equity controls $300 of collateral with $200 of debt. That is 3× leverage. If the collateral rises 10%, its value becomes $330 and equity becomes $130. If it falls 10%, equity becomes $70. This simplified long-position example excludes fees, interest, and rebalancing; live positions can behave differently.</p>
              <h3 id="trade-rebalancing">Rebalancing and liquidation</h3>
              <p>When a position crosses its rebalance threshold, the protocol can reduce its debt and collateral. This changes the exposure you keep. It does not restore lost equity or guarantee that liquidation cannot happen. Read the <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/rebalancing-the-position-liquidation-brake">rebalancing mechanism</ExternalLink> and <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/risk-management/risk-framework">risk framework</ExternalLink>. Use the current position’s thresholds rather than assuming a fixed price buffer.</p>
              <h3 id="trade-questions">Before you trade</h3>
              <p><strong>What can I trade here?</strong><br />ETH and BTC, long or short, on Ethereum through f(x) Protocol. Pay with the input asset you choose in the amount field.</p>
              <p><strong>How do I close or adjust a position?</strong><br />Open Positions and tap the position, then choose Add, Reduce, Leverage, or Close. Every change gets its own review before your wallet opens.</p>
              <p><strong>What do position values mean?</strong><br />Collateral, debt, and value are estimates read from Ethereum, not execution quotes. The line under each position says how far the price can move before the protocol starts rebalancing it; that is an estimate too.</p>
              <p><strong>Why can a review change before I sign?</strong><br />Prices and pool limits move. If the preview expires or signing details change, FxAeon shows the updated details and asks you to choose the action again.</p>
  </> },
  { id: 'positions', title: 'Position management', content: <>
<p>Positions are read from Ethereum. Each position is one row: its market and side, leverage, position number, and value, then a bar showing how much of it is debt and how much is yours, and one line saying how far the price can move before the protocol rebalances it, such as “Rebalances if ETH falls ≈ 25%”. The bar marks that point, with a fainter mark where liquidation could follow. If a position reaches it, the line says so.</p>
              <p>Tap a row to open the position: its collateral, debt, market price, and debt as a share of collateral, then Add, Reduce, Leverage, and Close, and for a long, Borrow against this position. All positions, or Back, returns to the list where you left it. On a wide screen the list stays beside the open position.</p>
              <p>An ETH long’s collateral reads in stETH, the unit the pool records it in. When you open or add to an ETH long, the new collateral arrives as wstETH, so the review converts it to stETH at the current rate and marks the estimate ≈. A minimum you sign stays in wstETH, with its stETH equivalent beneath.</p>
              <p>When display prices are validated, <strong>position value</strong> is estimated collateral value minus debt in USD. It is a display estimate, not a liquidation value or execution quote. The rebalance line is an estimate from live pool data and the market price, and it stays hidden when that data can’t be read. Unavailable values stay blank or show a loading placeholder while available position data remains visible.</p>
              <p>After a transaction, the app rereads state. Stale data can block an action until the current position and plan are available.</p>
  </> },
  { id: 'earn', title: 'Earn with fxSAVE', content: <>
<p>Earn reads fxSAVE balances, vault value, redemption status, and claimable amounts from Ethereum. Your fxSAVE value and the variable APY sit above the form. Its actions are deposit, withdraw, and claim.</p>
              <p>Deposit supports fxUSD, USDC, and fxSP, the f(x) Stability Pool share. Forms show the selected wallet’s verified balance, and token pickers pair quantity with estimated USD worth. Unavailable balances remain unknown, never zero; fxSAVE remains the withdrawal limit.</p>
              <p>Choose between an instant withdrawal and a queued withdrawal. The app reads the current instant-exit fee and cooldown from the protocol; check the terms shown before you submit. Deposits use a fixed minimum set by the f(x) SDK, shown in the review.</p>
              <div className={styles.referenceTable}><table><thead><tr><th>Withdrawal</th><th>What happens</th><th>Costs and protection</th></tr></thead><tbody>
                <tr><td>Instant</td><td>Redeem into the selected receive asset without waiting through the cooldown.</td><td>The instant-exit fee applies. The reviewed conversion minimum is enforced on-chain; a conversion below it reverts. Max slippage changes that minimum, not the fee.</td></tr>
                <tr><td>After cooldown</td><td>Request a withdrawal, wait for the displayed cooldown, then submit Claim to receive fxUSD and USDC.</td><td>No instant-exit fee. Network fees still apply to the request and claim. The instant conversion slippage setting does not apply to this queued path.</td></tr>
              </tbody></table></div>
              <p>See the protocol’s <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/developers/integrating-fxsave">fxSAVE redemption documentation</ExternalLink> for the underlying withdrawal methods.</p>
              <h3 id="earn-steps">Earn in three steps</h3>
              <ol>
                <li><strong>Deposit fxUSD or USDC.</strong> You receive fxSAVE, a share of f(x) Protocol’s savings vault.</li>
                <li><strong>Hold fxSAVE.</strong> The vault holds stability pool shares and compounds what they earn from position fees, wstETH staking, and USDC lending, so its value per share follows the vault. The APY is variable and comes from f(x) Protocol’s official feed.</li>
                <li><strong>Withdraw your way.</strong> Withdraw instantly for a fee, or queue it and claim once the cooldown ends.</li>
              </ol>
              <h3 id="earn-questions">Before you deposit</h3>
              <p><strong>What do I own?</strong><br />fxSAVE is an ERC-4626 vault share. The protocol describes it as an auto-compounding wrapper for Stability Pool rewards. Your token quantity and its redeemable value are separate figures. Read the <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/stability-pool">Stability Pool documentation</ExternalLink> for its peg operations, rewards, and dependency risks.</p>
              <p><strong>Is the APY guaranteed?</strong><br />No. It is variable and shown for information from f(x) Protocol’s feed. It never changes what you sign.</p>
              <p><strong>What does the stability pool do?</strong><br />It holds fxUSD and USDC, keeps fxUSD near a dollar by buying it below the peg and selling it above, and supplies the funds that rebalance leveraged positions. Its depositors earn from position fees, wstETH staking, and USDC lending; fxSAVE compounds those rewards.</p>
              <p><strong>How does a queued withdrawal work?</strong><br />It stays pending through the cooldown. When it is ready, Claim appears on Earn and on your Portfolio, and the claim pays out in fxUSD and USDC.</p>
              <p><strong>Can I use fxSAVE on Base?</strong><br />Yes. Move bridges fxUSD and fxSAVE between Ethereum and Base.</p>
  </> },
  { id: 'borrow', title: 'Borrow fxUSD', content: <>
<p>Borrow opens and manages an ETH or BTC collateral position on Ethereum. Start with the collateral: once you enter it, the form shows how much fxUSD it can support and your loan-to-value against the limit, and both update as you type. Repay fxUSD and withdraw collateral the same way.</p>
              <p>Under Your positions, choose Add collateral, Borrow more, Repay debt, or Withdraw collateral, or do two of them together. A long position on Positions also offers Borrow against this position. Fields show the selected wallet’s verified Ethereum balance when available, and pending reads stay distinct from zero. Collateral to withdraw shows how much can leave at current prices, within the position’s limits and contract rules.</p>
              <p>The review shows the loan-to-value the change leads to and, for a position you already hold, its loan-to-value now. Review the action details before signing. Withdrawing collateral can reduce the safety margin and increase liquidation risk.</p>
              <h3 id="borrow-steps">Borrow in three steps</h3>
              <ol>
                <li><strong>Deposit collateral.</strong> ETH, WETH, stETH, wstETH, or WBTC opens a collateral position on Ethereum.</li>
                <li><strong>Borrow up to the limit.</strong> The form shows how much fxUSD your collateral can support and your loan-to-value as you type, and names anything missing before review.</li>
                <li><strong>Repay to withdraw.</strong> Repay fxUSD at any time and withdraw collateral within the position’s limits.</li>
              </ol>
              <h3 id="borrow-questions">Before you borrow</h3>
              <p><strong>Why can debt exceed the fxUSD I receive?</strong><br />An opening fee can be added to debt. Repayment can also incur a closing fee. Under certain conditions the protocol can apply a temporary borrowing cost, so do not assume every loan is permanently interest-free. Check the review and the protocol’s <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/fxmint-borrowing-fxusd-against-your-btc-and-eth">fxMINT explanation</ExternalLink>.</p>
              <p><strong>What does the loan-to-value limit mean?</strong><br />Debt as a share of collateral value. Each pool sets a range, and FxAeon keeps a small margin under the top so a quote still fits when you sign.</p>
              <p><strong>Can I add collateral or borrow more later?</strong><br />Yes. On Borrow, under Your positions, add collateral, borrow more, repay, or withdraw. From a long position on Positions, Borrow against this position opens Borrow with that position selected. Each change gets its own review.</p>
              <p><strong>What happens if prices fall?</strong><br />Your loan-to-value rises. Automatic rebalancing can reduce leverage at protocol thresholds, and liquidation remains possible. Repaying or adding collateral lowers it.</p>
  </> },
  { id: 'move', title: 'Move between chains', content: <>
<p>Move bridges supported fxUSD and fxSAVE between Ethereum and Base through the f(x) bridge. Choose direction, asset, amount, and recipient. The connected wallet signs the transfer and pays its required fees; the recipient defaults to that wallet.</p>
              <p>Supported actions are checked against the selected chain, asset, balance, bridge connection, fee quote, and recipient. Expert mode takes custom token contracts for other LayerZero routes. Ethereum may require one approval before the send.</p>
              <div className={styles.callout}><p><strong>Before approval:</strong> check both networks, token identity, recipient, amount, and fee. Source confirmation and destination delivery are separate states; FxAeon verifies matching LayerZero events.</p></div>
              <h3 id="move-steps">Move in three steps</h3>
              <ol>
                <li><strong>Choose route and amount.</strong> Pick the direction, the asset, and how much. The recipient defaults to your wallet.</li>
                <li><strong>Approve and send.</strong> Ethereum may need one approval first. Your wallet pays the LayerZero fee shown in the review.</li>
                <li><strong>Delivery.</strong> Source confirmation and destination delivery are tracked separately; FxAeon verifies the matching LayerZero events.</li>
              </ol>
              <h3 id="move-questions">Before you move</h3>
              <p><strong>How long does a move take?</strong><br />It depends on both networks and LayerZero. History tracks the source confirmation and the delivery separately.</p>
              <p><strong>Can I send to another wallet?</strong><br />Yes. Choose Use another wallet and enter the recipient’s address on the destination network.</p>
              <p><strong>When would I use expert mode?</strong><br />To bridge a LayerZero token other than fxUSD or fxSAVE. Expert mode, at the end of the Move form, asks for the token’s contract on each network. Check every address and network before you approve.</p>
  </> },
  { id: 'fees', title: 'Fees & slippage', content: <>
<h3 id="fees-types">Separate the costs</h3>
<ul><li><strong>Network gas</strong> pays for chain execution. A browser wallet chooses its gas settings; the app’s gas-speed control is for the built-in wallet.</li><li><strong>f(x) fees</strong> depend on the action, market, and current governance settings. Review the quoted opening, closing, or withdrawal fee.</li><li><strong>Bridge fees</strong> pay for cross-chain messaging and delivery and are quoted separately in Move.</li><li><strong>Slippage</strong> is your execution tolerance, not an estimate of network gas. Use the minimum output in the review to understand what you accept.</li></ul>
<p>Fee rates can change. The <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/fees">protocol fee reference</ExternalLink> explains the categories; your current transaction review supplies the action-specific amounts.</p>
<p>Move shows the current LayerZero fee quote. Other actions show estimated gas and network cost when data is available; Base may add network and operator fees. Unavailable estimates stay labelled.</p>
              <p>A gas fee marked max is the most the network fee can be for every step together, so it is what your wallet must hold; usually less is charged. If your wallet doesn’t hold enough ETH for it, plus any ETH the action sends, the review says so before anything is signed: how much to add and on which network, with a Receive ETH link. When the fee can’t be fully estimated, it says more ETH is needed without guessing an amount.</p>
              <p>On Trade, Positions, and instant fxSAVE withdrawals, the settings gear sets max slippage: 0.1%, 0.5%, 1%, 2%, or a custom value up to 2%. fxSAVE deposits use the SDK’s fixed minimum, and Borrow and Move use their action defaults. Lower tolerance can fail; higher tolerance allows a lower minimum output. Network speed is available with FxAeon’s built-in wallet. An external wallet sets its own gas fee, so forms with only gas settings hide the gear on the web. Changes are saved on this device and apply to every open form.</p>
              <p>USD values and charts are display data. Execution follows the live protocol quote and contract checks.</p>
  </> },
  { id: 'history', title: 'History & recovery', aliases: ['recovery'], content: <>
              <p>Each transaction in History reads as the action it was, such as “Opened ETH Long”, the same name its position’s row uses. When an action was paid in ETH, its receipt states the ETH sent.</p>
              <p>History keeps drafts separate from submitted transactions. A draft is saved just before FxAeon asks your wallet to sign; it does not prove a wallet prompt opened or a transaction was submitted. Continue restores saved form values into a fresh review, never executable data. Connecting or refreshing never opens a wallet prompt.</p>
              <p>After a transaction hash is returned, FxAeon saves it on this device and checks the matching receipt and mined transaction details. A step is complete after its receipt is verified. This record is not a complete blockchain history.</p>
              <p>History checks the selected wallet and chain and never resends automatically. Inspect partially completed actions and wait for separate bridge delivery verification before retrying.</p>
  </> },
  { id: 'privacy', title: 'Privacy & risks', content: <>
<p><a href="/privacy.html">How FxAeon handles your data</a></p>
              <ul>
                <li>FxAeon has no account server, delegated signer, background executor, or private-key field. Your wallet approves each transaction.</li>
                <li>Theme, slippage, and recovery hints are stored on this device and reread against chain state.</li>
                <li>Review the address, network, contract, amount, recipient, and approval in every wallet prompt.</li>
                <li>Contract outcomes and liquidation risk are determined by the protocol and network. Wallets, network services, token contracts, bridges, and chains remain external dependencies.</li>
                <li>If rebalancing, liquidation, and reserves cannot cover bad debt, the protocol can redistribute losses across leveraged positions. Severe short-position insolvency can disable operations, and recapitalization can halt new long-position openings. These protections do not guarantee your principal. Read the protocol’s <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs/risk-management/risk-framework">risk framework</ExternalLink> before using leverage.</li>
              </ul>
  </> },
  { id: 'troubleshooting', title: 'Troubleshooting', content: <>
<h3 id="help-wallet">Wallet is not available</h3>
              <p>Wait for the wallet to load, reload if the screen reports a timeout, or reopen the Mini App from Telegram’s bot menu. Confirm that the wallet is connected and selected.</p>
              <h3 id="help-disabled">The action button is disabled</h3>
              <p>Check that an amount is positive, the amount format is valid for the selected token, the selected position is current, and any slippage or leverage value is within the displayed bounds.</p>
              <h3 id="help-gas">The review asks for more ETH</h3>
              <p>Network fees are paid in ETH on the network the action uses. Add at least the amount the review names, for example with Receive ETH, then review the action again.</p>
              <h3 id="help-receipt">The action stopped or a receipt is unclear</h3>
              <p>Read the status and History entry. A rejection, failed transaction, changed account, timeout, or receipt that does not match stops later steps. Do not resubmit until the wallet and chain state are understood.</p>
              <h3 id="help-delivery">Sent but not received</h3>
              <p>Keep the History entry open. A source transaction can confirm before destination funds arrive; FxAeon checks delivery separately.</p>
  </> },
];

export default function ProductArticle() {
  return <>{productSections.map((section) => <DocSection key={section.id} id={section.id} title={section.title} aliases={section.aliases}>{section.content}</DocSection>)}</>;
}
