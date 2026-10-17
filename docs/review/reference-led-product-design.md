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

The connected reference wallets were unfunded. No transaction, approval or signature was executed. Confirmation, receipt and populated management states are validated in FxAeon's existing controlled browser fixtures, not claimed as observed reference transactions.

## Implemented system

| Role | Decision |
| --- | --- |
| Canvas / card / inset | `#101214` / `#171a1f` / `#20242a` |
| Primary / secondary text | `#f2f4f7` / `#abb1bb` |
| Dividers | `#2b3037`; stronger edges only where useful |
| Primary action | White on `#2563eb` |
| Inline action / accent text | `#7da5ff`, separate from the filled-button color |
| Type | Inter for interface and financial figures; Manrope for brand/marketing |
| Geometry | 16px outer cards, 12px amount insets, 10px primary buttons, 20px floating dialogs |
| Interaction | At least 44px primary touch targets; visible keyboard focus; reduced-motion support |

Earn and Borrow separate overview facts from the action, use restrained aligned outcome rows, and retain truthful quote semantics. Move stays compact and centered. Settings and wallet selection use the same edges, surfaces and typography. The landing preserves its existing narrative and explicitly illustrative product preview.

On phones, position management and transaction reviews use bottom sheets consistent with the wallet profile. One sheet owns focus and scroll; an existing position manager contains its review without opening a second sheet. Desktop retains the inline action area. Actions and expanded details scroll inside the phone sheet, clear of the underlying navigation.

Preparing a review leaves its input visible. The review opens only after route construction, validation/simulation, fee selection and route-specific gas checks settle. One bounded, cancellable preparation budget rejects late results; wallet, network and form changes invalidate pending work. Expired quotes and later fee refreshes still require the existing fresh checks before signing.

Position cards are compact rectangles with separately labelled estimated rebalance and liquidation prices. These come from the existing validated pool thresholds and price readings. PnL is omitted at the user's request: the pinned SDK provides current collateral, debt and leverage, but no dependable entry-cost history. Current equity is never labelled as profit.

Dark is the sole appearance, including pre-hydration HTML, Telegram chrome, Privy and Docs. Earlier light/official preferences migrate without changing slippage or gas settings.

The wallet picker uses one centered desktop dialog and a phone sheet, with detected wallets first, consistent search and help views, and explicit pending, handoff and recovery states. It preserves the existing provider detection and verified wallet links. Unsupported connection methods and fabricated wallet counts are not added.

Review titles lead with the action and accepted leverage, such as `Long ETH 2.8×`. The leverage rail spans its actual minimum and maximum; the debt/equity explanation lives in the expanded help. Routine instructions that repeat an action or a visible outcome have been removed from Earn, Borrow, Move, Portfolio, Positions and wallet settings. Actual fees, risk, cooldown, quote-change and recovery messages remain.

The landing uses an original, dependency-free WebGL contour field with a static fallback. It pauses offscreen and in hidden tabs and respects reduced motion, the user's motion preference and data-saving mode. No shader library is added to the app bundle.

## Verification contract

- Build, lint, type checks and existing affected behavior suites.
- Actual source screenshots at 390px and 1280px; narrow viewport and enlarged-text checks.
- Input, review, confirmation/receipt and management fixtures retain quote freshness, wallet ownership and explicit signing steps.
- Wallet picker, settings, documentation navigation and saved-preference migration remain usable without a theme switcher.
- Palette contrast: primary CTA **5.17:1**, body on card **15.83:1**, secondary on inset **7.23:1**, tertiary on inset **5.77:1**, accent text on inset **6.46:1**.

Live network availability and actual wallet-app handoff remain separate from visual fixture evidence. No mock balance or invented quote is introduced into production.
