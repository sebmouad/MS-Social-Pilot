import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'No workspace' };
export default function NoWorkspace() { return <main className="auth-screen"><div className="auth-card"><h1>No workspace yet</h1><p>Your account has no workspace membership. Ask an owner to add you.</p></div></main>; }
