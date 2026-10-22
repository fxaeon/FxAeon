import { createElement, Fragment, isValidElement, type ReactNode } from 'react';
import styles from './Docs.module.css';

export { default as CodeBlock } from './CodeBlock';

/** Standalone topics place their content directly below the page h1, while
 * the complete reference nests that same content inside a titled section. */
export function topicContent(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(topicContent);
  if (!isValidElement<{ children?: ReactNode }>(node)) return node;
  if (node.type === Fragment) return createElement(Fragment, { key: node.key }, topicContent(node.props.children));
  if (typeof node.type !== 'string') return node;
  return createElement(node.type === 'h3' ? 'h2' : node.type, { ...node.props, key: node.key }, topicContent(node.props.children));
}

export function Callout({ title, children }: { title?: string; children: ReactNode }) {
  return <aside className={styles.callout}>{title && <strong>{title}</strong>}{children}</aside>;
}
