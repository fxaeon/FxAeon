import styles from './Docs.module.css';

export default function CodeBlock({ code, language = 'TypeScript', label }: { code: string; language?: string; label: string }) {
  return (
    <figure className={styles.codeBlock}>
      <figcaption className={styles.codeCaption}>
        <span>{label}<span className={styles.codeLanguage}>{language}</span></span>
      </figcaption>
      <pre tabIndex={0} aria-label={label}><code>{code}</code></pre>
    </figure>
  );
}
