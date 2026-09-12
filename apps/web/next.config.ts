import type { NextConfig } from 'next';

/**
 * Next configuration.
 *
 * `@fundxtra/shared` is a workspace package shipped as compiled CommonJS, so it
 * is transpiled here to keep tree-shaking working and to avoid the dual-package
 * hazard biting the browser bundle the way it bit the API's error handling.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@fundxtra/shared'],

  // The Mini App runs inside Telegram's WebView, and the marketing site is
  // plain public content. Neither should be framed by a third party, and
  // nothing here needs to be sniffed for a content type.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },

  images: {
    formats: ['image/avif', 'image/webp'],
  },

  experimental: {
    optimizePackageImports: ['framer-motion'],
  },
};

export default nextConfig;
