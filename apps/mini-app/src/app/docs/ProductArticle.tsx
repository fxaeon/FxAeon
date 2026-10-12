import type { ReactNode } from 'react';
import { ArrowRight, ArrowLeftRight, CandlestickChart, Landmark, Sprout } from 'lucide-react';
import { DocSection } from './DocsPrimitives';
import styles from './Docs.module.css';
import { ExternalLink } from './ExternalLink';

// Keep the card tree materialized so the content index sees its visible copy.
const topicCards = <div className={styles.topicGrid}>
    {[
      { href: '#trade', title: 'Trade & positions', description: 'Understand ETH and BTC longs, shorts, and leverage.', icon: CandlestickChart },
      { href: '#earn', title: 'Earn with fxSAVE', description: 'Deposit, withdraw, and follow a queued redemption.', icon: Sprout },
      { href: '#borrow', title: 'Borrow fxUSD', description: 'Manage collateral, debt, and repayments.', icon: Landmark },
      { href: '#move', title: 'Move between chains', description: 'Bridge supported assets between Ethereum and Base.', icon: ArrowLeftRight },
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
  </> },
  { id: 'getting-started', title: 'Getting started', content: <>
<ol>
                <li>Open FxAeon in a supported browser or Telegram. The app workspace starts on Portfolio.</li>
                <li>Connect your wallet, then choose Trade, Earn, Borrow, or Move.</li>
                <li>Enter the amount and check the asset, network, recipient, output, and fees.</li>
                <li>Confirm each transaction in your wallet. Each step continues after its matching receipt is verified.</li>
              </ol>
  </> },
  { id: 'access', title: 'Browser & Telegram', content: <>
<p>The web app and Telegram Mini App offer the same actions. Telegram adds native sizing, haptics, and navigation.</p>
              <p>In your browser, use Connect wallet to choose an existing wallet. In the Telegram Mini App, Privy powers sign-in and optional embedded wallets: sign in with email to create a wallet, or connect one you already use. Each transaction requires confirmation in your selected wallet.</p>
              <p>A Telegram link to one screen, such as Open Trade in Telegram on fxaeon.xyz, opens that screen directly. Telegram’s Back button then returns to where the app opened.</p>
  </> },
  { id: 'wallets', title: 'Wallets & signing', content: <>
<p>Your connected wallet supplies the sender. FxAeon does not receive or store private keys.</p>
              <p>A transaction may need more than one approval. The review says so before the first wallet request, for example “Two wallet requests: approve fxUSD, then confirm.” If its terms change before signing, review the updated details and choose the action again.</p>
              <div className={styles.callout}><p><strong>Before approval:</strong> confirm the address, network, recipient, amount, contract, and any approval request in your wallet.</p></div>
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
              <p>Withdrawals may be instant or queued. Queued redemptions remain pending through cooldown and expose Claim when ready. Action details show the transaction steps and, for instant withdrawals, the slippage and instant withdrawal fee. Deposits use a fixed minimum set by the f(x) SDK, shown in the review.</p>
              <h3 id="earn-steps">Earn in three steps</h3>
              <ol>
                <li><strong>Deposit fxUSD or USDC.</strong> You receive fxSAVE, a share of f(x) Protocol’s savings vault.</li>
                <li><strong>Hold fxSAVE.</strong> The vault holds stability pool shares and compounds what they earn from position fees, wstETH staking, and USDC lending, so its value per share follows the vault. The APY is variable and comes from f(x) Protocol’s official feed.</li>
                <li><strong>Withdraw your way.</strong> Withdraw instantly for a fee, or queue it and claim once the cooldown ends.</li>
              </ol>
              <h3 id="earn-questions">Before you deposit</h3>
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
<p>Move shows the current LayerZero fee quote. Other actions show estimated gas and network cost when data is available; Base may add network and operator fees. Unavailable estimates stay labelled.</p>
              <p>A gas fee marked max is the most the network fee can be for every step together, so it is what your wallet must hold; usually less is charged. If your wallet doesn’t hold enough ETH for it, plus any ETH the action sends, the review says so before anything is signed: how much to add and on which network, with a Receive ETH link. When the fee can’t be fully estimated, it says more ETH is needed without guessing an amount.</p>
              <p>Every action form has the same settings gear. On Trade, Positions, and instant fxSAVE withdrawals it sets max slippage: 0.1%, 0.5%, 1%, 2%, or a custom value up to 2%. fxSAVE deposits use the SDK’s fixed minimum, and Borrow and Move use their action defaults. Lower tolerance can fail; higher tolerance allows a lower minimum output. Network speed applies to FxAeon’s built-in wallet; a connected external wallet sets its own fee. Changes are saved on this device and apply to every open form.</p>
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
              </ul>
  </> },
  { id: 'troubleshooting', title: 'Troubleshooting', content: <>
<h3>Wallet is not available</h3>
              <p>Wait for the wallet to load, reload if the screen reports a timeout, or reopen the Mini App from Telegram’s bot menu. Confirm that the wallet is connected and selected.</p>
              <h3>The action button is disabled</h3>
              <p>Check that an amount is positive, the amount format is valid for the selected token, the selected position is current, and any slippage or leverage value is within the displayed bounds.</p>
              <h3>The review asks for more ETH</h3>
              <p>Network fees are paid in ETH on the network the action uses. Add at least the amount the review names, for example with Receive ETH, then review the action again.</p>
              <h3>The action stopped or a receipt is unclear</h3>
              <p>Read the status and History entry. A rejection, failed transaction, changed account, timeout, or receipt that does not match stops later steps. Do not resubmit until the wallet and chain state are understood.</p>
              <h3>Sent but not received</h3>
              <p>Keep the History entry open. A source transaction can confirm before destination funds arrive; FxAeon checks delivery separately.</p>
  </> },
];

export default function ProductArticle() {
  return <>{productSections.map((section) => <DocSection key={section.id} id={section.id} title={section.title} aliases={section.aliases}>{section.content}</DocSection>)}</>;
}
