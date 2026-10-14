'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { AppShell, Button, Card, copyText } from '@/components/ui';
import { GroupedAddress } from '@/components/GroupedAddress';
import { ChainIcon } from '@/components/TokenIcon';
import { WalletAvatar } from '@/components/WalletAvatar';
import { haptic } from '@/lib/telegram';
import { usePrivyWallet } from '@/lib/wallet';
import styles from '@/components/UtilitySurfaces.module.css';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { StickyAction } from '@/components/StickyAction';
import { PageHeading } from '@/components/ProductUI';

/**
 * Receive screen. The address is read from the selected Privy wallet only;
 * query strings, Telegram user IDs, and server responses never get to choose
 * a deposit destination.
 */
export default function QRPage() {
  return (
    <AppShell>
      <PageHeading title="Receive" backHref="/more" visible />
      <WalletQr />
    </AppShell>
  );
}

function WalletQr() {
  const walletState = usePrivyWallet();
  const { ready, authenticated } = walletState;
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const wallet = walletState.selectedWallet;

  if (!ready || !walletState.ready || !authenticated || !wallet) {
    return <WalletConnectCTA
      compact
      ready={ready && walletState.ready}
      authenticated={authenticated}
      body={authenticated ? 'Choose a wallet to show its receive address.' : 'Connect a wallet to show its receive address.'}
    />;
  }

  const address = wallet.address;
  const copy = async () => {
    setCopyFailed(false);
    if (await copyText(address)) {
      haptic('success');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } else {
      haptic('error');
      setCopyFailed(true);
    }
  };

  return (
    <div className={`${styles.utilityWorkspace} ${styles.qrWorkspace}`}>
      <Card className={styles.receiveCard}>
        <div className={styles.receiveIdentity}>
          <WalletAvatar address={address} size={36} />
          <div className="min-w-0">
            <p className={styles.receiveTitle}>Your wallet address</p>
            <p className={styles.receiveNetworks}>Ethereum and Base</p>
          </div>
          <span className={styles.networkStack} aria-hidden="true">
            <ChainIcon chainId={1} size={24} />
            <ChainIcon chainId={8453} size={24} />
          </span>
        </div>
        <div className={styles.qrTile}>
          <QRCodeSVG value={address} size={208} level="M" title="Your EVM wallet address for Ethereum or Base" />
        </div>
        <p className={styles.addressValue} title="Select this address to copy it manually">
          <GroupedAddress address={address} align="center" />
        </p>
        <StickyAction className={styles.copyDock}><Button onClick={copy} className={styles.copyAction} data-copied={copied || undefined}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          <span>{copied ? 'Copied' : 'Copy address'}</span>
        </Button></StickyAction>
        <p className={copyFailed ? styles.copyStatus : 'sr-only'} aria-live="polite">
          {copyFailed ? 'Copy was blocked. Press and hold the address to copy it.' : copied ? 'Address copied to clipboard.' : ''}
        </p>
      </Card>

      <div className={styles.receiveNotice} role="note">
        <AlertTriangle aria-hidden="true" />
        <p><strong>Check the network before sending.</strong> Use Ethereum or Base, then confirm the token is supported on that network.</p>
      </div>
    </div>
  );
}
