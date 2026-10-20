import { positionLeveragePresentation, positionTokenPresentation } from '@/lib/positionPresentation';

/** A completed position read never becomes a loading indicator for a missing metric. */
export function PositionLeverage({ position }: { position: Parameters<typeof positionLeveragePresentation>[0] }) {
  const presentation = positionLeveragePresentation(position);
  if (presentation.state === 'available') return <>{presentation.text}</>;
  return <span data-position-leverage={presentation.state}>{presentation.text}<span className="sr-only">. {presentation.explanation}</span></span>;
}

/** Exact accessible text accompanies compact copy; managers show the full value visibly. */
export function PositionTokenAmount({ raw, decimals, symbol, compact = false, smallUnit = false, unitClassName }: { raw: bigint; decimals: number; symbol: string; compact?: boolean; smallUnit?: boolean; unitClassName?: string }) {
  const presentation = positionTokenPresentation(raw, decimals, compact);
  const exposeExact = compact && presentation.exact !== null;
  return <span>
    <span aria-hidden={exposeExact || undefined}>{presentation.text} {smallUnit ? <small>{symbol}</small> : unitClassName ? <span className={unitClassName}>{symbol}</span> : symbol}</span>
    {exposeExact && <span className="sr-only">Exact amount: {presentation.exact} {symbol}</span>}
  </span>;
}
