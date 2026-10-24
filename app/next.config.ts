import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The OAuth consent screen must never be framed (clickjacking of the Allow button) or leak its URL.
  async headers() {
    return [{ source: '/oauth/:path*', headers: [
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Cache-Control', value: 'no-store' },
    ] }];
  },
};
export default nextConfig;
