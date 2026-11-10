import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lint runs in CI (npm run lint); a server build does not repeat it.
  eslint: { ignoreDuringBuilds: true },
  // The app never uses next/image (see middleware, which closes the optimizer endpoint).
  images: { unoptimized: true },
  // Sent with every response. Framing is limited to the app itself (clickjacking); HSTS only takes effect over HTTPS.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      ],
    }];
  },
  experimental: {
    // sharp and nodemailer ship both CommonJS and ES-module builds. Loading the ES-module one turns every module that
    // reaches them into an async module, and the platform registry's circular imports then fail at start-up
    // (« Cannot access before initialization »). Keep server packages on their CommonJS build.
    esmExternals: false,
    optimizePackageImports: ['@tabler/icons-react', 'echarts'],
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
