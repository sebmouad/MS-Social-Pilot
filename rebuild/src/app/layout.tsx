import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: { default: 'Social Pilot', template: '%s · Social Pilot' }, description: 'A clear workspace for every channel.' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
