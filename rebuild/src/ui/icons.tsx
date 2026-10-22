import type { ReactNode, SVGProps } from 'react';

type IconName = 'arrow' | 'back' | 'check' | 'chevron' | 'close' | 'copy' | 'external' | 'history' | 'info' | 'moon' | 'refresh' | 'shield' | 'sun' | 'wallet' | 'warning' | 'clock' | 'sliders';

const shapes: Record<IconName, ReactNode> = {
  arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  back: <><path d="M19 12H5m6-6-6 6 6 6" /></>,
  check: <path d="m5 12 4.5 4.5L19 7" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="3" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  external: <><path d="M13 4h7v7m0-7L9 15" /><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>,
  history: <><path d="M3 11a9 9 0 1 1 2.5 7M3 5v6h6" /><path d="M12 7v5l3 2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.2" /></>,
  moon: <path d="M20 14.2A8.8 8.8 0 0 1 9.8 4 8.8 8.8 0 1 0 20 14.2Z" />,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.3 7a8 8 0 0 1 13.2-1L20 8M4 16l1.5 2A8 8 0 0 0 18.7 17" /></>,
  shield: <><path d="m12 3 8 3v6c0 4-4.5 7-8 9-3.5-2-8-5-8-9V6l8-3Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  wallet: <><path d="M20 8H5a2 2 0 0 1 0-4h12v4M4 6v12a2 2 0 0 0 2 2h14V8" /><path d="M20 12h-5v4h5m-3-2h.1" /></>,
  warning: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5m0 3v.2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  sliders: <><path d="M4 7h7m4 0h5M4 17h2m4 0h10" /><circle cx="13" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
};

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{shapes[name]}</svg>;
}

/** Two cut planes and a shared axis: an original mark for the replacement. */
export function FxMark(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 40 40" width="36" height="36" fill="none" aria-hidden="true" focusable="false" {...props}><path fill="currentColor" d="M7 7h27l-6.7 8H16.1l-4.2 5H1.8L7 7Zm9.5 13H38l-7 8H20.3l-4.2 5H5.9l10.6-13Z" /></svg>;
}

/** Ethereum's familiar diamond, drawn locally without a remote asset request. */
export function EthereumMark(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 32 40" width="22" height="28" aria-hidden="true" focusable="false" {...props}><path d="M16 1 2 22l14 8 14-8L16 1Z" fill="currentColor" opacity=".88" /><path d="M16 1v29l14-8L16 1Z" fill="currentColor" opacity=".3" /><path d="m2 25 14 14 14-14-14 8L2 25Z" fill="currentColor" /><path d="M16 39V33l14-8-14 14Z" fill="currentColor" opacity=".35" /></svg>;
}
