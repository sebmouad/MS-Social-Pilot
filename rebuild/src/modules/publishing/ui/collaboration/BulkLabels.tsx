'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { assignConfirmation } from '@/modules/publishing/collaboration/schemas';
import { ConfirmDialog, send, useAction } from './collab-client';
import styles from './collaboration.module.css';
import { useCollaborationCopy } from '../compose/CopyProvider';
import { fillComposerCopy } from '../../composer-catalog';

type Label = { id: string; name: string; color: string };
type Post = { id: string; message: string; status: string; scheduledAt: string | null; labels: Label[] };
type Mode = 'add' | 'remove' | 'set';


export function BulkLabels({ initialPosts, labels, page, hasMore, query, canWrite, bulkLimit, labelsPerPost, searchMaxCharacters }: { initialPosts: Post[]; labels: Label[]; page: number; hasMore: boolean; query: string; canWrite: boolean; bulkLimit: number; labelsPerPost: number; searchMaxCharacters: number }) {
  const c = useCollaborationCopy();
const MODES: Array<{ id: Mode; title: string; hint: string }> = [
  { id: 'add', title: c.add_labels, hint: c.keeps_existing_labels_and_adds_the_chosen_ones },
  { id: 'remove', title: c.remove_labels, hint: c.removes_only_the_chosen_labels },
  { id: 'set', title: c.replace_labels, hint: c.posts_end_up_with_exactly_the_chosen_labels_none_clears_them },
];
  const [posts, setPosts] = useState(initialPosts);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>('add');
  const [review, setReview] = useState(false);
  const action = useAction();
  const toggle = (set: Set<string>, id: string) => { const next = new Set(set); if (!next.delete(id)) next.add(id); return next; };
  const confirmation = assignConfirmation(mode, selected.size);
  const invalid = selected.size === 0 || selected.size > bulkLimit || (mode !== 'set' && chosen.size === 0) || chosen.size > labelsPerPost;
  const href = (p: number) => `/content/library/fields?view=assign&page=${p}${query ? `&q=${encodeURIComponent(query)}` : ''}`;

  async function apply() {
    const ok = await action.run(async () => {
      const body = { postIds: [...selected], labelIds: [...chosen], mode, confirmation };
      const result = await action.send<{ posts: Array<{ postId: string; labelIds: string[] }> }>('POST', '/api/publishing/assignments', body);
      if (!Array.isArray(result.posts) || result.posts.length !== selected.size) throw new Error(c.the_result_could_not_be_verified_refresh_the_list_to_see_the);
      const byId = new Map(result.posts.map(p => [p.postId, p.labelIds]));
      setPosts(current => current.map(p => byId.has(p.id) ? { ...p, labels: labels.filter(l => byId.get(p.id)!.includes(l.id)) } : p));
      return fillComposerCopy(c.labelsUpdated, { count: selected.size, plural: selected.size === 1 ? '' : 's' });
    });
    if (ok) { setReview(false); setSelected(new Set()); }
  }

  return <div className={styles.root}>
    {action.banner}
    <form action="/content/library/fields" method="get" className={styles.search} role="search">
      <input type="hidden" name="view" value="assign" />
      <label htmlFor="bulk-search">{c.search_posts}<input id="bulk-search" name="q" defaultValue={query} maxLength={searchMaxCharacters} placeholder={c.words_in_the_post} /></label>
      <Button type="submit" variant="secondary">{c.search}</Button>{query && <a href="/content/library/fields?view=assign">{c.clear}</a>}
    </form>
    {canWrite && <section className={styles.section} aria-labelledby="bulk-controls"><h2 id="bulk-controls">{c.change_labels_on_selected_posts}</h2>
      <fieldset className={styles.form}><legend className={styles.meta}>{c.action}</legend>
        <div className={styles.actions}>{MODES.map(m => <label key={m.id} className={styles.check}><input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} />{m.title}</label>)}</div>
        <p className={styles.help}>{MODES.find(m => m.id === mode)!.hint}</p>
      </fieldset>
      {labels.length ? <fieldset className={styles.form}><legend className={styles.meta}>{c.labels}</legend><div className={styles.grid}>{labels.map(l => <label key={l.id} className={styles.check}><input type="checkbox" checked={chosen.has(l.id)} onChange={() => setChosen(c => toggle(c, l.id))} />{l.name}</label>)}</div></fieldset>
        : <p className={styles.empty}>{c.create_labels_first_in_labels_then_assign_them_here}</p>}
      <div className={styles.actions}><Button variant="primary" disabled={invalid || action.busy} onClick={() => setReview(true)}>{fillComposerCopy(c.reviewLabelsCount, { count: selected.size, plural: selected.size === 1 ? '' : 's' })}</Button>{selected.size > bulkLimit && <span role="alert">{fillComposerCopy(c.selectMax, { max: bulkLimit })}</span>}</div>
    </section>}
    {posts.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">{c.posts_and_their_labels}</caption>
      <thead><tr>{canWrite && <th scope="col">{c.select}</th>}<th scope="col">{c.post}</th><th scope="col">{c.status}</th><th scope="col">{c.labels}</th></tr></thead>
      <tbody>{posts.map(p => <tr key={p.id}>{canWrite && <td><input type="checkbox" aria-label={fillComposerCopy(c.selectPost, { title: p.message.slice(0, 40) || c.untitled })} checked={selected.has(p.id)} onChange={() => setSelected(s => toggle(s, p.id))} /></td>}
        <th scope="row"><a className={styles.msg} href={`/content/post/${encodeURIComponent(p.id)}`}>{p.message || c.untitled_post}</a></th>
        <td>{({ draft: c.status_draft, scheduled: c.status_scheduled, pending_approval: c.status_pending_approval, published: c.status_published, failed: c.status_failed, publishing: c.status_publishing, rejected: c.status_rejected } as Record<string, string>)[p.status] ?? p.status.replaceAll('_', ' ')}</td>
        <td>{p.labels.length ? <span className={styles.chips}>{p.labels.map(l => <span key={l.id} className={styles.chip}>{l.name}</span>)}</span> : <span className={styles.meta}>{c.no_labels}</span>}</td></tr>)}</tbody></table></div>
      : <p className={styles.empty}>{query ? c.no_posts_match_this_search : c.no_posts_yet_create_a_post_in_the_composer_to_organize_it}</p>}
    <nav className={styles.pagination} aria-label={c.post_pages}>{page > 1 ? <a href={href(page - 1)}>{c.previous_page}</a> : <span />}<span>{fillComposerCopy(c.pageNumber, { page })}</span>{hasMore ? <a href={href(page + 1)}>{c.next_page}</a> : <span />}</nav>
    <ConfirmDialog feedback={action.feedback} open={review} title={c.review_label_change} description={fillComposerCopy(c.reviewLabelsDescription, { action: MODES.find(m => m.id === mode)!.title, count: selected.size, plural: selected.size === 1 ? '' : 's' })} confirmation={confirmation} actionLabel={c.apply_change} busy={action.busy} onCancel={() => setReview(false)} onConfirm={() => void apply()}>
      <p>{c.labelsPrefix}<strong>{[...chosen].map(id => labels.find(l => l.id === id)?.name).filter(Boolean).join(', ') || c.none_clears_all_labels}</strong></p>
    </ConfirmDialog>
  </div>;
}
