'use client';

import { formatEther } from 'viem';
import { decodeActivityCall } from '@/lib/activityCalldata';
import type { MiniappTransaction } from '@/lib/miniappAccess';
import styles from '@/app/wallet-approval/WalletApproval.module.css';

function ApprovalAddress({ address }: { address: string }) {
  return <span title={address} className={styles.address}>
    <span aria-hidden="true">{address.slice(0, 8)}…{address.slice(-6)}</span>
    <span className={styles.srOnly}>{address}</span>
  </span>;
}

const RAW_LABELS: Record<string, string> = {
  from: 'From', to: 'To', chainId: 'Chain ID', value: 'Value (wei, hex)', data: 'Calldata',
  nonce: 'Nonce (hex)', gasLimit: 'Gas limit (hex)', gasPrice: 'Gas price (wei, hex)',
  maxFeePerGas: 'Maximum fee per gas (wei, hex)', maxPriorityFeePerGas: 'Priority fee per gas (wei, hex)',
};

/** Display-only decoding. No contract metadata, balances or decimal precision
 * are inferred from a selector. The immutable transaction remains authoritative.
 */
export function WalletApprovalDetails({ transaction, walletId }: { transaction: MiniappTransaction; walletId?: string }) {
  // approve/transfer contain exactly two ABI words. Extra calldata must remain
  // a generic contract call instead of suggesting an ordinary ERC-20 operation.
  const decoded = transaction.data.length === 138 ? decodeActivityCall(transaction.data) : null;
  const tokenCall = decoded?.kind === 'approve' || decoded?.kind === 'transfer' ? decoded : null;
  const action = tokenCall?.kind === 'approve' ? tokenCall.amount === 0n ? 'Revoke token approval' : 'Token approval'
    : tokenCall?.kind === 'transfer' ? 'Token transfer' : transaction.data === '0x' ? 'Send ETH' : 'Contract interaction';
  return <section className={styles.summary} aria-label="Transaction summary">
    <p className={styles.action}>{action}</p>
    <dl className={styles.facts}>
      <div><dt>Chain</dt><dd>{transaction.chainId === 1 ? 'Ethereum' : 'Base'}</dd></div>
      <div><dt>{tokenCall ? 'Token contract' : 'Recipient'}</dt><dd><ApprovalAddress address={transaction.to} /></dd></div>
      {tokenCall && <div><dt>{tokenCall.kind === 'transfer' ? 'Recipient' : 'Spender'}</dt>
        <dd><ApprovalAddress address={tokenCall.kind === 'transfer' ? tokenCall.recipient : tokenCall.spender} /></dd></div>}
      <div className={styles.value}><dt>ETH value</dt><dd>{formatEther(BigInt(transaction.value))} ETH</dd></div>
      {tokenCall && <div><dt>Raw token units (uint256)</dt><dd>{tokenCall.amount.toString()}</dd></div>}
    </dl>
    {tokenCall && <p className={styles.decoded}>Decoded ERC-20 {tokenCall.kind === 'approve' ? 'approve' : 'transfer'} call. Token details unverified.</p>}
    <details className={styles.details}><summary>Transaction details</summary><dl>
      {walletId && <div><dt>Wallet ID</dt><dd>{walletId}</dd></div>}
      {Object.entries(transaction).map(([key, value]) => <div key={key}><dt>{RAW_LABELS[key]}</dt><dd>{value}</dd></div>)}
    </dl></details>
  </section>;
}
