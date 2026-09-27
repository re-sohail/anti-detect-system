import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@lvd/shared'],
  poweredByHeader: false,
  // QEMU user networking exposes the host to guests as 10.0.2.2; allow it to load dev assets.
  // Production builds (`next build` + `npm start`) are unaffected.
  allowedDevOrigins: ['10.0.2.2'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
