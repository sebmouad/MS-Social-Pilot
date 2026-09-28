import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@prisma/client'],
  // Headers every response carries. Nothing here needs to be framed, sniffed or
  // handed a full referrer: the approve and publish buttons are exactly what a
  // clickjacking page would lay a decoy over, and a full Referer on an outbound
  // link would hand the destination our internal URLs. A Content-Security-Policy
  // is left to the proxy, because Next's inline bootstrap scripts need nonces
  // to live under one, and a policy that half-works is worse than none.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.fbcdn.net' },
      { protocol: 'https', hostname: 'graph.facebook.com' },
    ],
  },
};

export default withNextIntl(nextConfig);
