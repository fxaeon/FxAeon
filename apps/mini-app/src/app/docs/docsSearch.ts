import { Fragment, isValidElement, type ReactNode } from 'react';

export interface DocsEntry {
  id: string;
  title: string;
  page: 'Product guide' | 'SDK reference';
  href: string;
  text: string;
}

/** Derive the small, local index from the same content readers see. No service,
 * telemetry, credentials, or separately maintained keyword list is involved. */
export function textFromContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textFromContent).join(' ');
  if (!isValidElement<{ children?: ReactNode; code?: string; title?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>(node)) return '';
  // Decorative marks, such as a heading anchor's "#", are hidden from readers and from the index alike.
  const hidden = node.props['aria-hidden'];
  if (hidden === true || hidden === 'true') return '';
  return [node.props.title, node.props.code, textFromContent(node.props.children)].filter(Boolean).join(' ');
}

export function createDocsEntries(
  sections: readonly { id: string; title: string; content: ReactNode }[],
  page: DocsEntry['page'],
  path: string,
): DocsEntry[] {
  return sections.map(({ id, title, content }) => ({
    id, title, page, href: `${path}#${id}`, text: textFromContent(content).replace(/\s+/g, ' ').trim(),
  }));
}

/** Index each visible reference heading with its own explanation and destination.
 * Only flatten fragments: a nested heading must not swallow the next section. */
export function createHeadingEntries(
  sections: readonly { id: string; content: ReactNode }[],
  page: DocsEntry['page'],
  href: (id: string) => string,
): DocsEntry[] {
  function flatten(node: ReactNode): ReactNode[] {
    if (Array.isArray(node)) return node.flatMap(flatten);
    if (isValidElement<{ children?: ReactNode }>(node) && node.type === Fragment) return flatten(node.props.children);
    return [node];
  }
  return sections.flatMap(section => {
    const result: DocsEntry[] = [];
    let current: DocsEntry | undefined;
    for (const node of flatten(section.content)) {
      if (isValidElement<{ id?: string }>(node) && (node.type === 'h2' || node.type === 'h3')) {
        current = node.props.id ? { id: node.props.id, title: textFromContent(node).trim(), page, href: `${href(section.id)}#${node.props.id}`, text: '' } : undefined;
        if (current) result.push(current);
      } else if (current) {
        current.text = `${current.text} ${textFromContent(node)}`.replace(/\s+/g, ' ').trim();
      }
    }
    return result;
  });
}

export function legacyDocsDestinations(
  sections: readonly { id: string; aliases?: readonly string[]; content: ReactNode }[],
  href: (id: string) => string,
): Record<string, string> {
  function headingIds(node: ReactNode): string[] {
    if (Array.isArray(node)) return node.flatMap(headingIds);
    if (!isValidElement<{ id?: string; children?: ReactNode }>(node)) return [];
    if (node.type !== Fragment && typeof node.type !== 'string') return [];
    const own = (node.type === 'h2' || node.type === 'h3') && node.props.id ? [node.props.id] : [];
    return [...own, ...headingIds(node.props.children)];
  }
  return Object.fromEntries([
    ...sections.flatMap(section => [section.id, `${section.id}-heading`, ...(section.aliases ?? [])].map(id => [id, `${href(section.id)}#docs-page-heading`])),
    ...sections.flatMap(section => headingIds(section.content).map(id => [id, `${href(section.id)}#${id}`])),
  ]);
}

function normalize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function searchDocs(entries: readonly DocsEntry[], query: string): DocsEntry[] {
  const normalized = normalize(query);
  if (!normalized) return [];
  const terms = normalized.split(/\s+/);
  return entries
    .map((entry, order) => {
      const title = normalize(entry.title);
      const original = `${entry.title} ${entry.text}`;
      // Keep both forms: people may type a method as getFxSaveBalance,
      // getfxsavebalance, GETFXSAVEBALANCE, or "get fx save balance".
      const haystack = `${normalize(original)} ${original.toLowerCase()}`;
      const matches = terms.every((term) => haystack.includes(term));
      const score = title === normalized ? 3 : title.includes(normalized) ? 2 : terms.every((term) => title.includes(term)) ? 1 : 0;
      return { entry, order, matches, score };
    })
    .filter(({ matches }) => matches)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ entry }) => entry);
}

export function searchExcerpt(text: string, query: string): string {
  const term = query.trim().split(/\s+/).find((word) => text.toLowerCase().includes(word.toLowerCase()));
  const hit = term ? text.toLowerCase().indexOf(term.toLowerCase()) : 0;
  let start = Math.max(0, hit - 38);
  if (start > 0) start = text.indexOf(' ', start) + 1;
  const end = Math.min(text.length, start + 150);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
