export const sdkNavigation = [
  { id: 'sdk-overview', title: 'Integration overview', group: 'Start building', description: 'The official SDK, FxAeon’s wrappers, and the boundary between reads and signing.' },
  { id: 'sdk-setup', title: 'Read-only quickstart', group: 'Start building', description: 'Read protocol state with explicit units and no wallet request.' },
  { id: 'sdk-positions', title: 'Position methods', group: 'Method reference', description: 'Read, open, reduce, close, and adjust leveraged positions on Ethereum.' },
  { id: 'sdk-borrow', title: 'Borrow methods', group: 'Method reference', description: 'Prepare collateral and debt changes through the supported SDK methods.' },
  { id: 'sdk-bridge', title: 'Bridge methods', group: 'Method reference', description: 'Quote and build source-chain transfers; verify delivery separately.' },
  { id: 'sdk-earn', title: 'fxSAVE methods', group: 'Method reference', description: 'Read vault state and prepare deposits, withdrawals, and queued claims.' },
  { id: 'sdk-execution', title: 'Transaction lifecycle', group: 'Integration rules', description: 'Follow a plan through validation, review, wallet approval, and receipt verification.' },
  { id: 'sdk-boundaries', title: 'Limits & local patches', group: 'Integration rules', description: 'The locked method surface, reviewed patches, and deliberately unsupported behavior.' },
] as const;

export const sdkHref = (id: string) => `/docs/sdk/${id.replace(/^sdk-/, '')}`;
