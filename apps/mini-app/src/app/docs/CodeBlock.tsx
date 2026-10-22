'use client';

import { useEffect, useState } from 'react';
import DocsIcon from './DocsIcon';
import { copyText } from '@/lib/clipboard';
import styles from './Docs.module.css';

export default function CodeBlock({ code, language = 'TypeScript', label }: { code: string; language?: string; label: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = setTimeout(() => setCopyState('idle'), 2400);
    return () => clearTimeout(timer);
  }, [copyState]);
  return (
    <figure className={styles.codeBlock}>
      <figcaption className={styles.codeCaption}>
        <span>{label}<span className={styles.codeLanguage}>{language}</span></span>
        <button className={styles.copyCode} type="button" aria-label={`Copy ${label}`} onClick={async () => setCopyState(await copyText(code) ? 'copied' : 'failed')}>
          {copyState === 'copied' ? <DocsIcon name="Check" size={14} /> : <DocsIcon name="Copy" size={14} />}
          <span aria-live="polite">{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}</span>
        </button>
      </figcaption>
      <pre tabIndex={0} aria-label={label}><code>{code}</code></pre>
    </figure>
  );
}
