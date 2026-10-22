import { Component, StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRuntime } from '@runtime';
import { TradeController } from './domain/controller';
import type { StoragePort } from './domain/journal';
import { App } from './ui/App';

class InterfaceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  render(): ReactNode {
    if (this.state.failed) return <main style={{ padding: '3rem', fontFamily: 'system-ui', maxWidth: '42rem' }}>
      <h1>The interface could not be displayed</h1>
      <p>If a wallet request was already issued, check your wallet before submitting anything again. Reloading only restores observation; it never retries a trade.</p>
      <button type="button" onClick={() => location.reload()}>Reload FxAeon</button>
    </main>;
    return this.props.children;
  }
}

let storage: StoragePort | undefined;
try { storage = window.localStorage; } catch { /* Memory-only recovery remains available. */ }
const runtime = createRuntime();
const controller = new TradeController(runtime, { storage });
const routeFromHash = (): void => controller.navigate(location.hash === '#history' ? 'history' : 'trade');
routeFromHash();
window.addEventListener('hashchange', routeFromHash);
window.addEventListener('fxaeon:foreground', () => {
  void controller.refreshMarket();
  void controller.checkReceipt();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void controller.refreshMarket();
    void controller.checkReceipt();
  }
});
const root = document.getElementById('root');
if (!root) throw new Error('Missing application mount');
createRoot(root).render(<StrictMode><InterfaceBoundary><App controller={controller} runtime={runtime} /></InterfaceBoundary></StrictMode>);
void controller.refreshMarket();

if (import.meta.hot) import.meta.hot.dispose(() => {
  controller.dispose();
  runtime.wallet.dispose();
  runtime.host.dispose();
});
