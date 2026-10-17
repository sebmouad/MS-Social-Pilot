'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { SidebarDock } from '@/components/SidebarDock';
import { assignConfirmation } from '@/modules/publishing/collaboration/schemas';
import { ConfirmDialog, send, useAction } from './collab-client';
import styles from './collaboration.module.css';

type Label = { id: string; name: string; color: string };
type Post = { id: string; message: string; status: string; scheduledAt: string | null; labels: Label[] };
type Mode = 'add' | 'remove' | 'set';
const MODES: Array<{ id: Mode; title: string; hint: string }> = [
  { id: 'add', title: 'Add labels', hint: 'Keeps existing labels and adds the chosen ones.' },
  { id: 'remove', title: 'Remove labels', hint: 'Removes only the chosen labels.' },
  { id: 'set', title: 'Replace labels', hint: 'Posts end up with exactly the chosen labels (none clears them).' },
];

export function BulkLabels({ initialPosts, labels, page, hasMore, query, canWrite, bulkLimit, labelsPerPost, searchMaxCharacters }: { initialPosts: Post[]; labels: Label[]; page: number; hasMore: boolean; query: string; canWrite: boolean; bulkLimit: number; labelsPerPost: number; searchMaxCharacters: number }) {
  const [posts, setPosts] = useState(initialPosts);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>('add');
  const [review, setReview] = useState(false);
  const action = useAction();
  const toggle = (set: Set<string>, id: string) => { const next = new Set(set); if (!next.delete(id)) next.add(id); return next; };
  const confirmation = assignConfirmation(mode, selected.size);
  const invalid = selected.size === 0 || selected.size > bulkLimit || (mode !== 'set' && chosen.size === 0) || chosen.size > labelsPerPost;
  const href = (p: number) => `/publishing/collaboration?view=assign&page=${p}${query ? `&q=${encodeURIComponent(query)}` : ''}`;

  async function apply() {
    const ok = await action.run(async () => {
      const body = { postIds: [...selected], labelIds: [...chosen], mode, confirmation };
      const result = await send<{ posts: Array<{ postId: string; labelIds: string[] }> }>('POST', '/api/publishing/assignments', body);
      if (!Array.isArray(result.posts) || result.posts.length !== selected.size) throw new Error('The result could not be verified. Refresh the list to see the current labels.');
      const byId = new Map(result.posts.map(p => [p.postId, p.labelIds]));
      setPosts(current => current.map(p => byId.has(p.id) ? { ...p, labels: labels.filter(l => byId.get(p.id)!.includes(l.id)) } : p));
      return `Labels updated on ${selected.size} post${selected.size === 1 ? '' : 's'}.`;
    });
    if (ok) { setReview(false); setSelected(new Set()); }
  }

  return <div className={styles.root}>
    {action.banner}
    <SidebarDock><form action="/publishing/collaboration" method="get" className={styles.search} role="search">
      <input type="hidden" name="view" value="assign" />
      <label htmlFor="bulk-search">Search posts<input id="bulk-search" name="q" defaultValue={query} maxLength={searchMaxCharacters} placeholder="Words in the post" /></label>
      <Button type="submit" variant="secondary">Search</Button>{query && <a href="/publishing/collaboration?view=assign">Clear</a>}
    </form></SidebarDock>
    {canWrite && <section className={styles.section} aria-labelledby="bulk-controls"><h2 id="bulk-controls">Change labels on selected posts</h2>
      <fieldset className={styles.form}><legend className={styles.meta}>Action</legend>
        <div className={styles.actions}>{MODES.map(m => <label key={m.id} className={styles.check}><input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} />{m.title}</label>)}</div>
        <p className={styles.help}>{MODES.find(m => m.id === mode)!.hint}</p>
      </fieldset>
      {labels.length ? <fieldset className={styles.form}><legend className={styles.meta}>Labels</legend><div className={styles.grid}>{labels.map(l => <label key={l.id} className={styles.check}><input type="checkbox" checked={chosen.has(l.id)} onChange={() => setChosen(c => toggle(c, l.id))} />{l.name}</label>)}</div></fieldset>
        : <p className={styles.empty}>Create labels first in Labels, then assign them here.</p>}
      <div className={styles.actions}><Button variant="primary" disabled={invalid || action.busy} onClick={() => setReview(true)}>Review change for {selected.size} post{selected.size === 1 ? '' : 's'}</Button>{selected.size > bulkLimit && <span role="alert">Select at most {bulkLimit} posts.</span>}</div>
    </section>}
    {posts.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">Posts and their labels</caption>
      <thead><tr>{canWrite && <th scope="col">Select</th>}<th scope="col">Post</th><th scope="col">Status</th><th scope="col">Labels</th></tr></thead>
      <tbody>{posts.map(p => <tr key={p.id}>{canWrite && <td><input type="checkbox" aria-label={`Select post: ${p.message.slice(0, 40) || 'untitled'}`} checked={selected.has(p.id)} onChange={() => setSelected(s => toggle(s, p.id))} /></td>}
        <th scope="row"><a className={styles.msg} href={`/publishing/collaboration/post/${encodeURIComponent(p.id)}`}>{p.message || 'Untitled post'}</a></th>
        <td>{p.status.replaceAll('_', ' ')}</td>
        <td>{p.labels.length ? <span className={styles.chips}>{p.labels.map(l => <span key={l.id} className={styles.chip}>{l.name}</span>)}</span> : <span className={styles.meta}>No labels</span>}</td></tr>)}</tbody></table></div>
      : <p className={styles.empty}>{query ? 'No posts match this search.' : 'No posts yet. Create a post in the composer to organize it here.'}</p>}
    <nav className={styles.pagination} aria-label="Post pages">{page > 1 ? <a href={href(page - 1)}>Previous page</a> : <span />}<span>Page {page}</span>{hasMore ? <a href={href(page + 1)}>Next page</a> : <span />}</nav>
    <ConfirmDialog feedback={action.feedback} open={review} title="Review label change" description={`${MODES.find(m => m.id === mode)!.title} on ${selected.size} selected post${selected.size === 1 ? '' : 's'}. Nothing is published or rescheduled; only labels change.`} confirmation={confirmation} actionLabel="Apply change" busy={action.busy} onCancel={() => setReview(false)} onConfirm={() => void apply()}>
      <p>Labels: <strong>{[...chosen].map(id => labels.find(l => l.id === id)?.name).filter(Boolean).join(', ') || 'none (clears all labels)'}</strong></p>
    </ConfirmDialog>
  </div>;
}
