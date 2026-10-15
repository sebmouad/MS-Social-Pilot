'use client';

import { useActionState, useId, useState } from 'react';
import { importPostsAction } from './actions';
import styles from './import.module.css';

type Channel = { label: string; platform: string };

/** Imports draft posts from a CSV. Drafts only: nothing is published by an import. */
export function CsvImportForm({ channels }: { channels: Channel[] }) {
  const id = useId();
  const [state, action, pending] = useActionState(importPostsAction, null);
  const [localError, setLocalError] = useState('');
  const error = localError || state?.error || '';
  return <form action={action} noValidate className={styles.form} onSubmit={event => {
    const input = event.currentTarget.elements.namedItem('csv');
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]?.size) {
      event.preventDefault();
      setLocalError('Choose a CSV file that is not empty.');
      input instanceof HTMLInputElement && input.focus();
    } else setLocalError('');
  }}>
    <div className="ui-field">
      <label className="ui-label" htmlFor={`${id}-file`}>CSV file</label>
      <input id={`${id}-file`} className={`ui-input ${styles.file}`} type="file" name="csv" accept=".csv,text/csv" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={() => setLocalError('')} />
      {error ? <p id={`${id}-error`} className="ui-field-error" role="alert">{error}</p> : null}
    </div>
    <div className={styles.actions}>
      <button className="ui-button ui-button--primary" type="submit" disabled={pending} aria-busy={pending || undefined}>{pending ? 'Importing…' : 'Import as drafts'}</button>
      <a className="ui-button ui-button--quiet" href="/publishing/posts">Cancel</a>
    </div>
    <details className={styles.channels} open={channels.length > 0 && channels.length <= 8}>
      <summary>Channel labels to use in the channels column ({channels.length})</summary>
      {channels.length ? <ul>{channels.map(channel => <li key={channel.label}><code>{channel.label}</code></li>)}</ul> : <p className="ui-hint">No channels can publish yet. Rows can still be imported as drafts with an empty channels column.</p>}
    </details>
  </form>;
}
