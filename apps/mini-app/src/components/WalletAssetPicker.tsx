'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { AssetNetworkIcon, AssetRowContent, displayAssetSymbol, networkLabel } from '@/components/AssetPresentation';
import { useOverlayDialog } from '@/lib/useOverlayDialog';
import { useExitPresence } from '@/lib/useExitPresence';
import { haptic } from '@/lib/telegram';
import type { WalletAsset } from '@/lib/walletAssets';
import picker from '@/components/trade-surfaces.module.css';
import styles from './WalletAssetPicker.module.css';

/**
 * Chooses one wallet holding, by network. The sheet reuses the token picker's
 * surface and the Portfolio row, so a holding reads the same everywhere.
 */
export function WalletAssetPicker({ assets, value, onChange, label, disabled = false, loading = false, emptyLabel = 'No assets' }: {
  assets: readonly WalletAsset[];
  value: WalletAsset | undefined;
  onChange: (asset: WalletAsset) => void;
  label: string;
  disabled?: boolean;
  loading?: boolean;
  emptyLabel?: string;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const [open, setOpen] = useState(false);
  const present = useExitPresence(open, id);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const close = () => setOpen(false);
  const overlayRef = useOverlayDialog<HTMLDivElement>({ open, onClose: close, triggerRef });
  const selectedIndex = Math.max(0, assets.findIndex((asset) => asset.id === value?.id));

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
    // Initial focus only; selection changes close the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (asset: WalletAsset) => {
    haptic('selection');
    onChange(asset);
    close();
  };
  const focusOption = (index: number) => optionRefs.current[(index + assets.length) % assets.length]?.focus();
  const symbol = value ? displayAssetSymbol(value.symbol) : '';

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={styles.trigger}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={value ? `${label}: ${symbol} on ${networkLabel(value.chainId)}` : label}
      disabled={disabled || !assets.length}
      onClick={() => setOpen((current) => !current)}
    >
      {value ? <AssetNetworkIcon asset={value} size={28} /> : <span className={`${styles.placeholder}${loading ? ' skeleton' : ''}`} aria-hidden="true" />}
      <span className={styles.copy}>
        <strong>{value ? symbol : loading ? 'Loading' : emptyLabel}</strong>
        {value && <small>{networkLabel(value.chainId)}</small>}
      </span>
      <ChevronDown aria-hidden="true" className={styles.chevron} data-open={open || undefined} />
    </button>
    {present && typeof document !== 'undefined' && createPortal(
      <div
        className={picker.tokenPickerBackdrop}
        data-state={open ? 'open' : 'closed'}
        inert={!open}
        aria-hidden={!open || undefined}
        role="presentation"
        onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
      >
        <div ref={overlayRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={picker.tokenPickerDialog} onMouseDown={(event) => event.stopPropagation()}>
          <div className={picker.tokenPickerHeader}>
            <p id={titleId} className={picker.tokenPickerTitle}>{label}</p>
            <button type="button" aria-label="Close asset picker" onClick={close} className={`${picker.tokenPickerClose} glass-press`}>×</button>
          </div>
          <div role="listbox" aria-label={`${label} options`} className={picker.tokenPickerList}>
            {assets.map((asset, index) => {
              const active = asset.id === value?.id;
              return <button
                key={asset.id}
                ref={(element) => { optionRefs.current[index] = element; }}
                type="button"
                role="option"
                aria-selected={active}
                aria-label={`${displayAssetSymbol(asset.symbol)} on ${networkLabel(asset.chainId)}${active ? ', selected' : ''}`}
                tabIndex={index === selectedIndex ? 0 : -1}
                className={`${picker.tokenPickerRow} ${styles.row} ${active ? picker.tokenPickerRowActive : ''}`}
                onClick={() => choose(asset)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') { event.preventDefault(); focusOption(index + 1); }
                  else if (event.key === 'ArrowUp') { event.preventDefault(); focusOption(index - 1); }
                  else if (event.key === 'Home') { event.preventDefault(); focusOption(0); }
                  else if (event.key === 'End') { event.preventDefault(); focusOption(assets.length - 1); }
                }}
              >
                <AssetRowContent asset={asset} />
              </button>;
            })}
          </div>
        </div>
      </div>,
      document.body,
    )}
  </>;
}
