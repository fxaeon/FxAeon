import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { usePrivyWallet } from '@/lib/wallet';
import { PrivyWalletBridge } from '@/lib/wallet/PrivyWalletBridge';

declare global {
  var __privySendHarness: any;
}

function Harness() {
  const [, rerender] = useState(0);
  const wallet = usePrivyWallet();
  useEffect(() => {
    globalThis.__privySendHarness.rerender = () => rerender((n) => n + 1);
    return () => { globalThis.__privySendHarness.rerender = undefined; };
  }, []);
  const send = async (buttonText: string, preflight = true, dispatch = wallet.sendTransaction) => {
    const h = globalThis.__privySendHarness;
    h.result = 'pending';
    rerender((n) => n + 1);
    try {
      if (preflight) await wallet.waitForPreviousConfirmationClose?.();
      const result = await dispatch({
        from: h.requestFrom,
        to: '0x00000000000000000000000000000000000000dd',
        data: '0x12345678',
        value: 7n,
        nonce: 8n,
        gasLimit: 21000n,
        gasPrice: h.fees?.gasPrice ?? 9n,
        maxFeePerGas: h.fees?.maxFeePerGas ?? 10n,
        maxPriorityFeePerGas: h.fees?.maxPriorityFeePerGas ?? 2n,
        chainId: h.targetChain ?? 1,
      }, { action: buttonText === 'Approve token' ? 'Token approval' : 'Protocol action', buttonText });
      h.result = result.hash;
      h.previousResult = result.hash;
    } catch (error) {
      h.result = `error:${error instanceof Error ? error.message : String(error)}`;
    }
    h.rerender?.();
  };
  return <main data-ready={String(wallet.ready)} data-authenticated={String(globalThis.__privySendHarness.authenticated)} data-user-id={globalThis.__privySendHarness.userId} data-connection-version={wallet.connectionVersion ?? 0} data-address={wallet.address ?? ''} data-result={globalThis.__privySendHarness.result} data-modal-open={globalThis.__privySendHarness.modalOpen ? 'true' : 'false'}>
    <button onClick={() => wallet.selectWallet('0x00000000000000000000000000000000000000aa')}>Select first wallet</button>
    <button onClick={() => void wallet.disconnect()}>Disconnect</button>
    <button onClick={() => wallet.selectWallet('0x00000000000000000000000000000000000000bb')}>Select second wallet</button>
    <button onClick={() => {
      // Invoke the retained callback in this same click, before React can
      // publish the selection's new connectionVersion to the bridge.
      const retained = wallet.sendTransaction;
      wallet.selectWallet(wallet.address!);
      void send('Approve token', false, retained);
    }}>Send retained callback after reselection</button>
    <button onClick={() => void send('Approve token')}>Send approval</button>
    <button onClick={() => void send('Confirm transaction')}>Send action</button>
    <button onClick={() => void send('Confirm transaction', false)}>Send action without preflight</button>
    <button onClick={() => { const h = globalThis.__privySendHarness; h.modalOpen = false; h.modalRerender?.(); rerender((n) => n + 1); }}>Close Privy success screen</button>
  </main>;
}

const root = createRoot(document.getElementById('root')!);
globalThis.__privySendHarness.unmount = () => root.unmount();
root.render(<PrivyWalletBridge><Harness /></PrivyWalletBridge>);
