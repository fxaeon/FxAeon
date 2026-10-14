import { RollingFigure } from './RollingFigure';
import styles from './SplitFigure.module.css';

/**
 * A formatted figure whose fractional part recedes so whole units lead, and
 * whose digits roll when it changes. The text content stays the exact
 * formatted string.
 */
export function SplitFigure({ value, fractionClassName = styles.fraction }: { value: string; fractionClassName?: string }) {
  return <RollingFigure value={value} fractionClassName={fractionClassName} />;
}
