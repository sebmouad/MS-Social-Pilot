import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'MS Social Pilot',
  description: 'Schedule and publish Facebook Page and Group posts from one place.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
