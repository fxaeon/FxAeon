# Reference-led product refinement

## Brief

Study the live Aave and Morpho applications at the level of real tasks and transaction states. Preserve FxAeon's working product and financial safeguards. Implement one coherent visual system across the app and landing, then check the actual rendered result on phone and desktop layouts. The final user direction is dark only; remove appearance choices and migrate earlier saved preferences.

## Professional method

Start with the live interface, its actual wallet state, rendered typography, input behavior, disabled states and data hierarchy. The supplied HTML concepts and earlier screenshots are comparison material, not a specification to reproduce.

Inventory the path from discovery to input, review, wallet confirmation and management. Compare what a user needs to decide at each step. Use browser inspection to distinguish visual hierarchy from financial meaning. Measure the real DOM and responsive layout, implement in existing components, and verify with screenshots, keyboard/viewport checks and transaction-state tests.

Correctness needs evidence outside a design opinion: readable contrast, unclipped exact values, reachable actions, preserved quote/owner checks, honest empty and unavailable states, and consistent handoff between steps. Aesthetic quality also needs human review of the rendered product; automated checks alone cannot establish it.

## Raw observations

- **Aave:** connected empty-wallet dashboard, Supply entry, Wrapped ETH reserve detail, wallet-specific Supply/Borrow availability and settings. Public reserve facts occupy a broad reading area; wallet availability and actions occupy a bounded side card. Empty-wallet guidance describes the actual prerequisite. Labels, separators and aligned values do most of the organizational work.
- **Morpho:** vault listing, Steakhouse Prime USDC detail, Your Position empty state, variable-rate markets and USDC/cbBTC borrowing input. Desktop tables use restrained row divisions and align related figures. The action area is about 400px wide, with amount, token and wallet balance grouped together. Entering example collateral/debt updates explicit before/after rows while the unfunded wallet keeps execution disabled.
- **Measured Morpho typography:** Inter Variable in body/navigation; approximately 13px navigation, 15px section tabs and 32–40px controls. Its large product title uses a separate light display face. FxAeon retains its own licensed Inter/Manrope assets rather than copying that font or brand.
- **Rejected concepts:** their mode controls, simulated balances and overlapping app/website presentations added another interface to learn. Existing FxAeon already has clearer entry points and real transaction state; preserve those strengths.

References: [Aave](https://app.aave.com/), [Morpho](https://app.morpho.org/).

### Landing comparison — 17 October 2026

The live [Morpho marketing site](https://morpho.org/) was inspected separately at desktop and phone widths. Its advantage is a coherent art direction: one precise blue line-and-grid language spans the hero and audience illustrations; light display typography and generous repeated section spacing establish the hierarchy; live deposit/loan figures and actual customer stories supply evidence. At a 1280px viewport its hero uses FK Grotesk at approximately 68px and weight 300. This is a reference observation, not an asset or font to copy.

FxAeon's earlier hero used a second form-like card over an indistinct contour effect. Combined with several different section widths, it made the landing feel assembled. The subsequent diagram and generated glass artwork also competed with the products. The current hero uses a large headline beside concise capabilities and entry actions, followed immediately by the original dark product cards. The calculator remains the place to explore amounts. The owner approved those original cards and the footer; the FAQ was not part of that approval.

A useful comparison is whether the page has a recognizable composition without reading every label, maintains that hierarchy on a phone, and makes each next action obvious. Contrast, keyboard behavior, data freshness, responsive screenshots and motion checks establish usability and implementation quality. They do not establish that a design is aesthetically superior or that it converts better; those claims require independent user evaluation.

The connected reference wallets were unfunded. No transaction, approval or signature was executed. Confirmation, receipt and populated management states are validated in FxAeon's existing controlled browser fixtures, not claimed as observed reference transactions.

### Landing direction — 18 October 2026

The owner clarified that the landing should show what users can do. Detailed explanations and transaction warnings belong in the app and docs. The original dark “Four ways to use FxAeon.” cards and footer are the visual baseline; the later blue cards and generated hero artwork were rejected.

The five additional references were inspected on desktop and phone:

| Reference | Observed design principle | Application to FxAeon |
| --- | --- | --- |
| [Tesla Roadster](https://www.tesla.com/roadster) | One dominant product image, sparse copy and a clear action; the phone composition is deliberate. | Give the first screen one hierarchy and keep product actions visible on phones. |
| [Turtle](https://www.turtle.xyz/) | Quiet charcoal surfaces, a limited green accent, clear audience actions and a consistent diagram language. | Use the dark cards' existing visual language throughout; keep secondary facts quiet. |
| [Sui](https://www.sui.io/) | A single blue geometric scene frames the main message and two entry actions. | Color and motion need one coherent idea. Blue itself was not the problem with the rejected pass. |
| [BNB Smart Chain](https://www.bnbchain.org/en/bnb-smart-chain) | A consistent yellow block motif occupies a defined region and adapts beneath the copy on phones. | Protect space for the heading and actions; do not scatter unrelated decoration. |
| [Lido](https://lido.fi/) | A recognizable asset form, a specific staking proposition, and product metrics beside the action. | Put current APY and TVL in the Earn calculator where they inform the choice. |

The original cards work through product-specific relationships: a chart for Trade, layered savings for Earn, collateral tickets for Borrow, and a route between networks for Move. Charcoal surfaces, small bright details and asymmetric sizing give those visuals room. The rejected glass art had no equally clear product role, while the blue pass gave too much of the page the same emphasis.

Future landing changes should preserve that approved baseline, demonstrate a capability, and make its next action obvious. Do not add a decorative hero, risk lecture, redundant FAQ, or protocol explanation merely to fill a section. Review real mobile and desktop renders before calling a change an improvement.

The owner clarified that Morpho is a benchmark for cleanliness and copy, not a composition to reproduce. FxAeon's own product artwork remains the visual anchor. A single blue highlight crosses the hero's second line, then rests; the existing chart, savings layers and bridge artwork animate only while visible, and all decorative motion pauses in a background tab. Reduced-motion preferences keep everything still. Product links have visible launch arrows and one keyboard focus ring. A smaller product heading gives the opening and illustrations distinct emphasis, and the tablet hero stacks deliberately with both launch actions together.

The landing header spans the viewport at 72px on desktop and 64px on phones. Its background blends with the opening and gains a subtle border and translucent surface after scrolling. This replaces the inset opaque rectangle that visibly covered the product cards. The layout was reviewed at 390px, 820px and 1440px, with browser checks from 320px through 1440px. The app work was merged separately in [PR304](https://github.com/fxaeon/FxAeon/pull/304); these landing changes remain a separate review.

## Implemented system

| Role | Decision |
| --- | --- |
| Canvas / card / inset | `#101214` / `#171a1f` / `#20242a` |
| Primary / secondary text | `#f2f4f7` / `#abb1bb` |
| Dividers | `#2b3037`; stronger edges only where useful |
| Primary action | White on `#2563eb` |
| Inline action / accent text | `#7da5ff`, separate from the filled-button color |
| Type | Inter for interface and financial figures; Manrope for brand/marketing; Poppins in the restored landing footer |
| Geometry | 16px outer cards, 12px amount insets, 10px primary buttons, 20px floating dialogs |
| Interaction | At least 44px primary touch targets; visible keyboard focus; reduced-motion support |

Earn and Borrow separate overview facts from the action, use restrained aligned outcome rows, and retain truthful quote semantics. Move stays compact and centered. Settings and wallet selection use the same edges, surfaces and typography. The landing keeps a concise hero and product story: a web-app and Mini App CTA pair; four linked cards for Trade, Earn, Borrow and Move; and a calculator at `#outcomes` headed “What your crypto can do.” The calculator labels its starting value in USD, provides three amount presets, and presents the selected result and action after its controls on phones. The Telegram section and original footer follow; the footer keeps its Poppins text face, Manrope headings and all-width web launch link. The hero credit reads “Powered By f(x) SDK” beneath the lede. Earn applies the current fxSAVE APY to the chosen starting amount for one year, assuming the rate does not change. Borrow shows a 50% loan-to-value scenario. Trade shows an ETH long's response to a ±10% ETH move at the chosen leverage. Results are labeled before protocol and network costs; FxAeon does not add its own fee. The calculator is independent of the wallet and does not request a signature.

The calculator consumes a same-origin, read-only `/api/market-data` feed. fxSAVE TVL and APY come from Aladdin's [official `concentrator_aToken_tvl_apy` feed](https://api.aladdin.club/api1/concentrator_aToken_tvl_apy) and are accepted only for the verified fxSAVE contract `0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39`. The feed has no source-updated timestamp; the value expires five minutes after the server checked it. fxSAVE TVL describes the vault, not total protocol TVL. ETH conversion uses the WETH quote from [DefiLlama's price feed](https://coins.llama.fi/); quote confidence must be at least 0.5 and the source timestamp must be within five minutes, allowing at most two minutes of future skew. The unused price ticker and separate proof strip have been removed. The Retry live data control appears only when a required metric is unavailable or stale, and during a user-requested retry. The UI drops expired values from projections and ETH units. Sources are fetched server-side through a fixed Pages Function with no API keys, no client-to-provider connections, an eight-second upstream deadline, 256 KB response cap, and no more than 60 seconds of in-memory cache. Upstream failures leave the affected metric unavailable while preserving other valid metrics.

The landing no longer markets borrowing with a “0%” rate or a matching explanatory disclaimer. Borrowing costs and risk remain in the app and docs where users make that decision. The hero provides matching web and Mini App CTAs at every viewport size, and product cards route directly to app screens. The deployed asset set includes the referenced card artwork, fonts and licenses; no standalone hero artwork or contour effect is loaded.

On phones, position management and transaction reviews use bottom sheets consistent with the wallet profile. One sheet owns focus and scroll; an existing position manager contains its review without opening a second sheet. Desktop retains the inline action area. Actions and expanded details scroll inside the phone sheet, clear of the underlying navigation.

Preparing a review leaves its input visible. The review opens only after route construction, validation/simulation, fee selection and route-specific gas checks settle. One bounded, cancellable preparation budget rejects late results; wallet, network and form changes invalidate pending work. Expired quotes and later fee refreshes still require the existing fresh checks before signing.

Position cards are compact rectangles with separately labelled estimated rebalance and liquidation prices. These come from the existing validated pool thresholds and price readings. PnL is omitted at the user's request: the pinned SDK provides current collateral, debt and leverage, but no dependable entry-cost history. Current equity is never labelled as profit.

Dark is the sole appearance, including pre-hydration HTML, Telegram chrome, Privy and Docs. Earlier light/official preferences migrate without changing slippage or gas settings.

The wallet picker uses one centered desktop dialog and a phone sheet, with detected wallets first, consistent search and help views, and explicit pending, handoff and recovery states. It preserves the existing provider detection and verified wallet links. Unsupported connection methods and fabricated wallet counts are not added.

Review titles lead with the action and accepted leverage, such as `Long ETH 2.8×`. The leverage rail spans its actual minimum and maximum; the debt/equity explanation lives in the expanded help. Routine instructions that repeat an action or a visible outcome have been removed from Earn, Borrow, Move, Portfolio, Positions and wallet settings. Actual fees, risk, cooldown, quote-change and recovery messages remain.

The owner selected the supplied Phantom wallet screenshots as the primary Portfolio reference. Its useful qualities are the dominant balance, larger readable token identity and quantity, generous spacing, and individual softly rounded holding rows. FxAeon uses those hierarchy choices without importing Phantom's promotions, prediction markets or brand color. The connected Portfolio shows one balance followed by Send, Receive, Trade and More. Tokens, DeFi and Activity are separate keyboard-accessible panels. Account and chain details remain in the header controls; redundant labels, balance explanations, protocol headings, counts and routine price notices are omitted. Missing values are never replaced with invented prices. Position rows expand to numeric accounting and threshold facts, while fxSAVE expands to its actions. Actual stale-position and elevated-risk states remain conditional. The loading view follows the same layout, and a wallet change resets the selected view and network.

### Portfolio alignment and product forms — 18 October 2026

The owner requested that the balance, wallet actions and section switch align to the holdings' left edge on desktop and phones. The network filter shares the desktop section toolbar and aligns with the holdings' right edge; it moves below the switch on narrow screens. Token rows and position summaries share the same icon, identity, value and disclosure columns. Expanded position facts align beneath the identity on desktop and become a two-column grid on phones. Interactive controls retain visible keyboard focus, while the containing Tokens and DeFi panels no longer add a redundant keyboard stop. The owner explicitly preferred the previous missing-price indicator; retain it with its accessible unavailable label.

The disconnected Portfolio has a short wallet entry and public Trade, Earn and Borrow links. It does not present a fictional balance. On Portfolio, the account drawer initially collapses its duplicate token list so account actions remain easy to reach. Earn and Borrow use larger product identities and aligned financial figures beside a focused action column. Amount fields and switches use the Portfolio's neutral surfaces; transaction checks, actual rates and withdrawal terms remain in their existing flows.

Earn and Borrow omit redundant visible route headings and center the initial overview and form within the desktop viewport; growing forms remain scrollable and phones keep a single column. Borrow's repeated “Before conversion and fees” note is removed. Bridge uses a narrower centered form and omits the input-stage source-gas and delivery placeholders; the review still shows its actual fees and estimates. Positions is a dedicated page with a heading and New position action, without a competing tab navigation. Verified positions have a value, collateral and debt overview, followed by the position list and management controls. Disconnected, empty and failed reads use the same page width and a contained state panel. A read failure says “Couldn’t load positions”; missing prices or incomplete reads never become zero or a fabricated total.

## Verification contract

Positions opens as a compact list on desktop. Management appears only after selection. On phones it opens in the same bottom-sheet style as transaction review, with content-sized height and settings/close beside the position identity. Its value row expands to the threshold estimates, collateral, debt and secondary borrowing action. Add keeps the amount, Max, editable target leverage and primary action in view; its slider expands on request. The Leverage action opens its slider directly. Normal rebalance prose and the duplicate balance bar are omitted; elevated-risk messages remain visible even with details closed. Settings and asset pickers layer above management, and dismissal restores the selected row and list position.

Keyboard focus uses one 2px light-blue ring following the control's radius. Amount, search, slippage and leverage entry wrappers own their text input's ring; a focused preset or asset selector does not also outline its parent. Noninteractive page, heading and dialog focus targets do not draw whole-screen frames. Slider thumbs show a ring when focused or dragged, without a permanent halo. Forced-colors focus remains visible.

- Build, lint, type checks and existing affected behavior suites.
- Actual source screenshots at 390px and 1280px; narrow viewport and enlarged-text checks.
- Input, review, confirmation/receipt and management fixtures retain quote freshness, wallet ownership and explicit signing steps.
- Wallet picker, settings, documentation navigation and saved-preference migration remain usable without a theme switcher.
- The landing remains readable and useful when one or all market feeds are unavailable; there are no demo quotes or fallback financial values presented as current.
- Landing static assets and `apps/landing/functions/api/market-data.ts` deploy together from the `apps/landing` Pages project. A static-only deployment intentionally leaves market values unavailable.
- The illustrative calculator is behavior-tested and visually reviewed at mobile and desktop sizes. No conversion improvement is claimed without user research or a controlled experiment.
- Palette contrast: primary CTA **5.17:1**, body on card **15.83:1**, secondary on inset **7.23:1**, tertiary on inset **5.77:1**, accent text on inset **6.46:1**.

Live network availability and actual wallet-app handoff remain separate from visual fixture evidence. Market-data tests cover source identity, timestamp/confidence checks, partial failures, stale quote rejection, out-of-order refreshes, foreground recovery, bounded responses and server deadlines; the Pages Function compiles with Wrangler. No mock balance or invented live quote is introduced into production.
