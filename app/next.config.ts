import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ['@tabler/icons-react', 'echarts'],
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
