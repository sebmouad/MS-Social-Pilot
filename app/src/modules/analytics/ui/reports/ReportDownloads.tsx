'use client';

import { useEffect, useRef, useState } from 'react';
import { IconDownload, IconFileTypePdf } from '@tabler/icons-react';
import { Button, useToast } from '@/components';
import styles from './workflows.module.css';
import { downloadCopyDefaults, type DownloadCatalog } from './download-copy';

type PreparedDownloads = { filename: string; csv: string; html: string; json: string | null };


/** CSV/JSON are service-produced artifacts; PDF uses the browser's print dialog, never a renamed HTML file. */
export function ReportDownloads({ prepared, locale = 'en', copy = downloadCopyDefaults }: { prepared: PreparedDownloads; locale?: 'en' | 'fr'; copy?: DownloadCatalog }) {
  const toast = useToast();
  const c = Object.fromEntries(Object.entries(copy).map(([key, value]) => [key, value[locale]])) as Record<keyof DownloadCatalog, string>;
  const [printing, setPrinting] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const printLaunched = useRef(false);
  const printCleanup = useRef<(() => void) | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const objectUrls = useRef(new Set<string>());
  const printRequested = useRef(false);
  useEffect(() => () => { for (const url of objectUrls.current) URL.revokeObjectURL(url); objectUrls.current.clear(); }, [prepared]);

  function download(kind: 'csv' | 'html' | 'json') {
    const content = prepared[kind];
    if (content === null) return;
    let link: HTMLAnchorElement | null = null;
    try {
      const url = URL.createObjectURL(new Blob([content], { type: kind === 'csv' ? 'text/csv;charset=utf-8' : kind === 'json' ? 'application/json;charset=utf-8' : 'text/html;charset=utf-8' }));
      objectUrls.current.add(url);
      link = document.createElement('a'); link.href = url; link.download = `${prepared.filename}.${kind}`; link.hidden = true;
      document.body.append(link); link.click();
      toast.notify({ title: c.prepared, tone: 'success' });
    } catch { toast.failed(c.failed, () => download(kind), c[kind]); }
    finally { link?.remove(); }
  }

  useEffect(() => () => { printCleanup.current?.(); }, []);
  useEffect(() => {
    if (!printing && printLaunched.current) {
      wrapper.current?.querySelector<HTMLButtonElement>('[data-report-print]')?.focus();
      printLaunched.current = false;
    }
  }, [printing]);
  function finishPrint() {
    printCleanup.current?.(); printCleanup.current = null;
    printRequested.current = false; setPrinting(false);
  }
  function print() {
    if (printRequested.current) return;
    printRequested.current = true; setPrinting(true);
  }
  return <div ref={wrapper} className={styles.actions}>
    <Button size="sm" leading={<IconDownload size={16} />} onClick={() => download('csv')}>{c.csv}</Button>
    {prepared.json !== null && <Button size="sm" onClick={() => download('json')}>{c.json}</Button>}
    <Button size="sm" onClick={() => download('html')}>{c.html}</Button>
    <Button data-report-print size="sm" leading={<IconFileTypePdf size={16} />} title={c.printHelp} busy={printing} disabled={printing} onClick={print}>{c.pdf}</Button>
    {printing && <Button size="sm" onClick={finishPrint}>{c.close}</Button>}
    {printing && <iframe ref={frame} title={c.frame} className={styles.printFrame} sandbox="allow-same-origin allow-modals" srcDoc={prepared.html} onLoad={() => {
      if (printLaunched.current) return;
      printLaunched.current = true;
      try {
        const view = frame.current?.contentWindow;
        if (!view) throw new Error('unavailable');
        view.addEventListener('afterprint', finishPrint, { once: true });
        printCleanup.current = () => view.removeEventListener('afterprint', finishPrint);
        view.focus(); view.print(); toast.notify({ title: c.printing });
      } catch { finishPrint(); toast.failed(c.printFailed, () => download('html'), c.html); }
    }} />}
  </div>;
}
