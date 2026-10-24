'use client';
import { useState } from 'react';
import { Button } from './Button';

/** Private operator guidance; authentication never comes from this component. */
export function RootMcpConnection() {
  const [notice, setNotice] = useState('');
  async function copy() {
    try {
      const endpoint = new URL('/api/mcp', window.location.origin);
      endpoint.searchParams.set('scope', 'installation');
      await navigator.clipboard.writeText(endpoint.href);
      setNotice('Installation endpoint copied.');
    } catch { setNotice('Copy unavailable. Use /api/mcp?scope=installation on this app’s origin.'); }
  }
  return <section className="root-control__panel" aria-labelledby="root-mcp-title">
    <h2 id="root-mcp-title">Installation MCP access</h2>
    <p>Use a fully verified installation-owner browser session for private configuration, workspace access and audit history. Workspace membership is optional.</p>
    <p><code className="root-control__endpoint">/api/mcp?scope=installation</code></p>
    <Button type="button" onClick={() => void copy()}>Copy endpoint URL</Button>
    {notice && <p role="status">{notice}</p>}
    <p>This endpoint accepts session authentication. Workspace API keys cannot use it. Use <code>?scope=workspace</code> for workspace-only access. The global MCP switch and request limits still apply.</p>
    <p>All writes require exact confirmation and use the same audited services as Root. <a href="/root/config">Review MCP configuration</a>.</p>
  </section>;
}
