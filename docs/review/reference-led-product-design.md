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

FxAeon's earlier hero used a second form-like card over an indistinct contour effect. Combined with several different section widths, it made the landing feel assembled. The refinement opens the starting-value graphic into a connected diagram using FxAeon's own mark, aligns the core content rails, and gives the heading and product paths distinct visual roles. The interactive calculator remains the place to explore amounts. The user-approved production product cards, FAQ and footer are preserved.

A useful comparison is whether the page has a recognizable composition without reading every label, maintains that hierarchy on a phone, and makes each next action obvious. Contrast, keyboard behavior, data freshness, responsive screenshots and motion checks establish usability and implementation quality. They do not establish that a design is aesthetically superior or that it converts better; those claims require independent user evaluation.

The connected reference wallets were unfunded. No transaction, approval or signature was executed. Confirmation, receipt and populated management states are validated in FxAeon's existing controlled browser fixtures, not claimed as observed reference transactions.

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

Earn and Borrow separate overview facts from the action, use restrained aligned outcome rows, and retain truthful quote semantics. Move stays compact and centered. Settings and wallet selection use the same edges, surfaces and typography. The landing keeps a concise hero and product story: a web-app and Mini App CTA pair; four linked bento cards for Trade, Earn, Borrow and Move; and a calculator at `#outcomes` headed “What your crypto can do.” The calculator labels its starting value in USD, provides three amount presets, and presents the selected result and action after its controls on phones. The restored FAQ and production footer sit below the product story; the footer keeps its Poppins text face, Manrope headings and all-width web launch link. The hero credit reads “Powered By f(x) SDK” beneath the lede, without a network/Telegram badge row. Earn applies the current fxSAVE APY to the chosen starting amount for one year, assuming the rate does not change. Borrow shows a 50% loan-to-value calculation. Trade shows an ETH long's gross response to a ±10% ETH move at the chosen leverage. These are scenarios, not wallet state, executable quotes, borrowing limits, or liquidation estimates. The calculator is independent of the wallet and does not request a signature.

The calculator and proof strip consume a same-origin, read-only `/api/market-data` feed. fxSAVE TVL and APY come from Aladdin's [official `concentrator_aToken_tvl_apy` feed](https://api.aladdin.club/api1/concentrator_aToken_tvl_apy) and are accepted only for the verified fxSAVE contract `0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39`. The feed has no source-updated timestamp; the value expires five minutes after the server checked it. fxSAVE TVL describes the vault, not total protocol TVL. ETH (via WETH) and BTC (via WBTC) prices come from [DefiLlama's price feed](https://coins.llama.fi/); quote confidence must be at least 0.5 and the source timestamp must be within five minutes, allowing at most two minutes of future skew. Each proof value's title metadata names its provider and gives the fxSAVE checked time or the ETH/BTC source-update time; the page has no visible source-disclosure section. The Retry live data control appears only when a metric is unavailable or stale, and during a user-requested retry. The UI drops expired values instead of leaving stale numbers in the proof strip, projections, or ETH units. Sources are fetched server-side through a fixed Pages Function with no API keys, no client-to-provider connections, an eight-second upstream deadline, 256 KB response cap, and no more than 60 seconds of in-memory cache. Upstream failures leave the affected metric unavailable while preserving other valid metrics.

The “0%” borrow claim refers to fxMINT's base annual interest. Official f(x) [borrowing documentation](https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/fxmint-borrowing-fxusd-against-your-btc-and-eth) lists opening/closing fees and describes a temporary funding cost under [peg-stress conditions](https://fxprotocol.gitbook.io/fx-docs/faq/how-does-f-x-protocol-minimize-funding-costs-or-annual-interests); [fee settings](https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/fees) are governance-adjustable. The hero provides the matching web and Mini App CTAs at every viewport size; product cards route directly to web app screens, while the hero diagram links to matching calculator scenarios. The Telegram, FAQ and footer sections remain. The live hero no longer uses the retired mockup artwork; the deployed files contain only currently referenced artwork, fonts and licenses, plus the original lightweight contour effect and its static fallback.

On phones, position management and transaction reviews use bottom sheets consistent with the wallet profile. One sheet owns focus and scroll; an existing position manager contains its review without opening a second sheet. Desktop retains the inline action area. Actions and expanded details scroll inside the phone sheet, clear of the underlying navigation.

Preparing a review leaves its input visible. The review opens only after route construction, validation/simulation, fee selection and route-specific gas checks settle. One bounded, cancellable preparation budget rejects late results; wallet, network and form changes invalidate pending work. Expired quotes and later fee refreshes still require the existing fresh checks before signing.

Position cards are compact rectangles with separately labelled estimated rebalance and liquidation prices. These come from the existing validated pool thresholds and price readings. PnL is omitted at the user's request: the pinned SDK provides current collateral, debt and leverage, but no dependable entry-cost history. Current equity is never labelled as profit.

Dark is the sole appearance, including pre-hydration HTML, Telegram chrome, Privy and Docs. Earlier light/official preferences migrate without changing slippage or gas settings.

The wallet picker uses one centered desktop dialog and a phone sheet, with detected wallets first, consistent search and help views, and explicit pending, handoff and recovery states. It preserves the existing provider detection and verified wallet links. Unsupported connection methods and fabricated wallet counts are not added.

Review titles lead with the action and accepted leverage, such as `Long ETH 2.8×`. The leverage rail spans its actual minimum and maximum; the debt/equity explanation lives in the expanded help. Routine instructions that repeat an action or a visible outcome have been removed from Earn, Borrow, Move, Portfolio, Positions and wallet settings. Actual fees, risk, cooldown, quote-change and recovery messages remain.

The landing pairs custom FxAeon-mark capital-field artwork with an original, dependency-free WebGL contour shader. It pauses offscreen and in hidden tabs and follows the system reduced-motion preference and data-saving mode; there is no page-level motion control. Retired concept artwork and unused legacy fonts are excluded from the deploy. No shader library is added to the app bundle.

## Verification contract

- Build, lint, type checks and existing affected behavior suites.
- Actual source screenshots at 390px and 1280px; narrow viewport and enlarged-text checks.
- Input, review, confirmation/receipt and management fixtures retain quote freshness, wallet ownership and explicit signing steps.
- Wallet picker, settings, documentation navigation and saved-preference migration remain usable without a theme switcher.
- The landing remains readable and useful when one or all market feeds are unavailable; there are no demo quotes or fallback financial values presented as current.
- Landing static assets and `apps/landing/functions/api/market-data.ts` deploy together from the `apps/landing` Pages project. A static-only deployment intentionally leaves market values unavailable.
- The illustrative calculator is behavior-tested and visually reviewed at mobile and desktop sizes. No conversion improvement is claimed without user research or a controlled experiment.
- Palette contrast: primary CTA **5.17:1**, body on card **15.83:1**, secondary on inset **7.23:1**, tertiary on inset **5.77:1**, accent text on inset **6.46:1**.

Live network availability and actual wallet-app handoff remain separate from visual fixture evidence. Market-data tests cover source identity, timestamp/confidence checks, partial failures, stale quote rejection, out-of-order refreshes, foreground recovery, bounded responses and server deadlines; the Pages Function compiles with Wrangler. No mock balance or invented live quote is introduced into production.
