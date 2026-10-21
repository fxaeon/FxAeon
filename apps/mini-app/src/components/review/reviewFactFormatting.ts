import type { ReviewFact } from '../../lib/fx/reviewFormatting';
import { groupDigits } from '../../lib/amount';
import { readableReviewAmount } from './reviewHierarchy';

export type FormattedReviewFactValue = {
  /** Display copy only. Never use this to construct an amount or signing term. */
  display: string;
  /** Original strings remain untouched, including punctuation and caveats. */
  original: string;
  detail?: string;
  shortened: boolean;
  changed: boolean;
  approximate: boolean;
  expandable: boolean;
};

const DECIMAL = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
const TOKEN_VALUE = new RegExp(`^(≈\\s*)?([+-]?)(${DECIMAL}) ([A-Za-z][A-Za-z0-9._-]*)( \\(${DECIMAL}%\\))?( max)?$`);
const CURRENCY_VALUE = new RegExp(`^(≈\\s*)?([+-]?)([$€£])(${DECIMAL})$`);
const PERCENT_VALUE = new RegExp(`^(≈\\s*)?([+-]?)(${DECIMAL})%$`);
const TOKEN_RATIO = new RegExp(`^(≈\\s*)?([+-]?)(${DECIMAL})( ([A-Za-z][A-Za-z0-9._-]*)\\s*/\\s*([A-Za-z][A-Za-z0-9._-]*))$`);
const CURRENCY_RATIO = new RegExp(`^(≈\\s*)?([+-]?)([$€£])(${DECIMAL})(\\s*/\\s*([A-Za-z][A-Za-z0-9._-]*))$`);
// A standalone word is not necessarily a token. Do not turn timing, multiple,
// or ratio text into a financial amount simply because it begins with digits.
const NON_TOKEN_UNITS = /^(?:max|min|mins|minute|minutes|s|sec|secs|second|seconds|h|hr|hrs|hour|hours|d|day|days|x|per|of|to|bps|units?)$/i;

/**
 * Conservatively compact complete amounts, percentages and token-denominated prices.
 * Do not mine an arbitrary title for a number: titles also carry quote caveats,
 * conversion ratios and signed minima whose units may differ from the value.
 * Only a complete slash-separated price ratio is recognized, without conversion.
 * Comparisons, free-form ratios, identifiers and unknown text remain unchanged.
 */
export function formatReviewFactValue(fact: Pick<ReviewFact, 'label' | 'value' | 'title'>): FormattedReviewFactValue {
  const original = fact.value;
  const detail = fact.title && fact.title !== original ? fact.title : undefined;
  let display = original;
  let shortened = false;
  let approximate = /^≈/.test(original);
  const token = TOKEN_VALUE.exec(original);
  const currency = CURRENCY_VALUE.exec(original);
  const percent = PERCENT_VALUE.exec(original);
  const tokenRatio = TOKEN_RATIO.exec(original);
  const currencyRatio = CURRENCY_RATIO.exec(original);
  let parsed: { amount: string; sign: string; prefix: string; suffix: string; approximate: boolean } | undefined;
  if (token && !NON_TOKEN_UNITS.test(token[4])) {
    parsed = { amount: token[3], sign: token[2], prefix: '', suffix: ` ${token[4]}${token[5] ?? ''}${token[6] ?? ''}`, approximate: Boolean(token[1]) };
  } else if (currency) {
    parsed = { amount: currency[4], sign: currency[2], prefix: currency[3], suffix: '', approximate: Boolean(currency[1]) };
  } else if (percent) {
    parsed = { amount: percent[3], sign: percent[2], prefix: '', suffix: '%', approximate: Boolean(percent[1]) };
  } else if (tokenRatio && !NON_TOKEN_UNITS.test(tokenRatio[5]) && !NON_TOKEN_UNITS.test(tokenRatio[6])) {
    parsed = { amount: tokenRatio[3], sign: tokenRatio[2], prefix: '', suffix: tokenRatio[4], approximate: Boolean(tokenRatio[1]) };
  } else if (currencyRatio && !NON_TOKEN_UNITS.test(currencyRatio[6])) {
    parsed = { amount: currencyRatio[4], sign: currencyRatio[2], prefix: currencyRatio[3], suffix: currencyRatio[5], approximate: Boolean(currencyRatio[1]) };
  }
  if (parsed) {
    const rounded = readableReviewAmount(parsed.amount.replace(/,/g, ''));
    shortened = rounded.shortened;
    approximate = parsed.approximate || shortened;
    display = `${approximate ? '≈ ' : ''}${parsed.sign}${parsed.prefix}${groupDigits(rounded.value)}${parsed.suffix}`;
  }
  const changed = display !== original;
  return { display, original, detail, shortened, changed, approximate, expandable: changed || detail !== undefined };
}
