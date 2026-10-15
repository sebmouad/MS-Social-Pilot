import { redirect } from 'next/navigation';
import { requireViewer } from '@/server/context';
import { canAccessFeature } from '@/server/permissions';
import { csvDestinationLabel } from '@/lib/publishing/csv-destinations';
import { PageHeading } from '../publishing-ui';
import { loadChannelChoices } from '../channels';
import { CsvImportForm } from './CsvImportForm';
import styles from './import.module.css';

export const metadata = { title: 'Import posts' };

export default async function ImportPage() {
  const viewer = await requireViewer({ feature: 'publishing/import', channelScoped: true });
  if (!canAccessFeature(viewer.permissions, 'publishing/import', 'write')) redirect('/publishing/posts');
  const channels = (await loadChannelChoices(viewer)).filter(channel => channel.canPublish);
  return <>
    <PageHeading title="Import posts" description="Add many draft posts at once from a CSV file. Nothing is published by an import." />
    <div className={styles.layout}>
      <section className={styles.panel} aria-labelledby="import-upload">
        <h2 id="import-upload">Upload a file</h2>
        <CsvImportForm channels={channels.map(channel => ({ label: csvDestinationLabel(channel), platform: channel.kindLabel }))} />
      </section>
      <section className={styles.panel} aria-labelledby="import-format">
        <h2 id="import-format">File format</h2>
        <p>The first row is the header: <code>message,firstComment,channels</code>.</p>
        <ol className={styles.steps}>
          <li><strong>message</strong> is the post text. It is required.</li>
          <li><strong>firstComment</strong> is optional. Leave it empty for none.</li>
          <li><strong>channels</strong> lists channel labels separated by semicolons. Leave it empty to import a plain draft.</li>
        </ol>
        <p>Every row becomes a draft. Open it from Posts to add media, schedule it, or publish it.</p>
      </section>
    </div>
  </>;
}
