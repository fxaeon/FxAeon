/** Optional definitions only. Amounts, limits, warnings and exact transaction
 * evidence belong in the visible interface, never in this registry. Callers
 * opt into a named definition; we deliberately do not infer from fact.title. */
export const INFO_HELP_CONTENT = {
  maxSlippage: 'The maximum adverse price movement allowed between quote and execution. Raising it permits a larger difference, without guaranteeing execution.',
  networkSpeed: 'The speed setting changes the priority fee offered to the network. A higher priority fee can improve the chance of earlier inclusion, but timing is not guaranteed.',
  minimumReceived: 'The lowest output amount permitted by this quote after the selected slippage tolerance. It is a limit, not the expected amount received.',
  estimatedReceived: 'The expected output at the quoted conditions. The final amount can differ; use the displayed minimum received when a minimum applies.',
  priceImpact: 'The estimated effect of this transaction on its execution price compared with the reference price. It is different from slippage tolerance.',
  targetLeverage: 'The exposure multiple requested for the position. The quoted effective leverage can differ after execution costs and rounding.',
  effectiveLeverage: 'The exposure multiple estimated for the quoted position after its calculated collateral, debt and costs.',
  liquidationPrice: 'Liquidation can cause losses. An estimated price at which the position may become eligible for liquidation under the protocol rules. Position changes and charges can move this estimate.',
  loanToValue: 'Debt divided by collateral value, expressed as a percentage. A higher percentage leaves less room before the applicable borrowing limit.',
  networkFee: 'The network charge for submitting and executing the transaction. A displayed maximum is a cap, not a promise that the full amount will be spent.',
  protocolFee: 'A charge applied by the protocol for this action. It is separate from the network fee.',
  fxSaveApy: 'An annualized estimate of the vault’s variable yield. It describes a rate, not a guaranteed return or the amount earned so far.',
  vaultHoldings: 'Assets held by the whole vault, rather than your personal balance. A displayed dollar value is an estimate.',
  fxSaveShares: 'fxSAVE represents shares in the vault. Share units and underlying asset units are different; the conversion depends on vault assets and share supply.',
  cooldown: 'The waiting period before a queued withdrawal can be claimed. The displayed withdrawal status and available time determine when you can continue.',
  instantWithdrawal: 'A withdrawal path that skips the cooldown and applies the displayed instant-withdrawal fee.',
  route: 'The contracts and conversion steps used to carry out the quoted action. Exact addresses and execution data remain available in execution details.',
  executionPrice: 'The price implied by the quoted execution amounts. It describes this quote, rather than a guaranteed market price at confirmation.',
  rebalancePrice: 'Rebalancing can reduce collateral and debt. An estimated price associated with the protocol’s rebalance threshold. It is distinct from the liquidation estimate and can change with the position.',
  bridgeFee: 'The quoted charge for moving assets between networks. Network transaction fees may be shown separately.',
  borrowRate: 'The base protocol borrowing terms do not establish the current funding charge. Temporary funding charges may apply; an unknown current rate must be shown as unavailable.',
  collateralAccounting: 'ETH long positions use wstETH backing, while collateral and risk prices use stETH accounting. BTC long positions use WBTC collateral accounting. Short positions use fxUSD collateral accounting. Position units are not necessarily the deposited wallet token units.',
  debtAdded: 'The increase in the position’s debt. This can differ from the amount received after fees and other quoted deductions.',
} as const;

export type InfoHelpKey = keyof typeof INFO_HELP_CONTENT;
