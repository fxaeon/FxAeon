import type { InfoHelpKey } from '../infoHelpContent';

/** Definitions are opt-in by semantic label. Financial values, exact evidence,
 * warnings and quote-specific caveats never become optional help. */
export function reviewHelpDefinition(label: string): InfoHelpKey | undefined {
  const definitions: Record<string, InfoHelpKey> = {
    Slippage: 'maxSlippage', 'Max. slippage': 'maxSlippage',
    'Minimum received': 'minimumReceived', 'Quoted minimum received': 'minimumReceived',
    'Minimum fxSP': 'minimumReceived', 'Final fxSAVE minimum': 'minimumReceived',
    'Price impact': 'priceImpact', 'Execution price': 'executionPrice',
    'Rebalance price': 'rebalancePrice', 'Liquidation price': 'liquidationPrice',
    'Loan-to-value': 'loanToValue', 'Borrow rate': 'borrowRate',
    'Gas fee': 'networkFee', 'Bridge fee': 'bridgeFee', 'f(x) fee': 'protocolFee',
    'Protocol fee': 'protocolFee', 'Debt added': 'debtAdded',
    'Collateral': 'collateralAccounting', 'Estimated collateral': 'collateralAccounting',
    'Target leverage': 'targetLeverage', 'Leverage': 'effectiveLeverage',
    'Current APY': 'fxSaveApy',
  };
  return definitions[label];
}
