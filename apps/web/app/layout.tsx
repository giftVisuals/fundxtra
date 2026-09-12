import type { Metadata, Viewport } from 'next';
import { BRAND, tokenStylesheet } from '@fundxtra/shared';
import { config } from '@/lib/config';
import './globals.css';

/**
 * Root layout.
 *
 * Shared by the marketing site, the Mini App and the admin console, so it
 * carries only what all three need: fonts, metadata, and the brand's white
 * background. Surface-specific chrome lives in the nested layouts.
 *
 * The font stack is system-first on purpose. A Mini App inside Telegram should
 * start instantly on a mid-range Android phone over a Nigerian mobile
 * connection, and a webfont request is the single easiest thing to remove from
 * that path. System UI fonts also match what the rest of the user's phone
 * looks like, which is exactly the native feel we want.
 */

export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
  keywords: [
    'Fundxtra', 'earn online Nigeria', 'Telegram rewards', 'complete tasks earn money',
    'airtime rewards', 'data rewards', 'Telegram Stars', 'Telegram Premium', 'referral rewards',
  ],
  authors: [{ name: BRAND.name, url: config.siteUrl }],
  openGraph: {
    type: 'website',
    siteName: BRAND.name,
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.description,
    url: config.siteUrl,
    locale: 'en_NG',
    images: [{ url: '/brand/icon-512.png', width: 512, height: 512, alt: `${BRAND.name} logo` }],
  },
  twitter: {
    card: 'summary',
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.description,
    images: ['/brand/icon-512.png'],
  },
  icons: {
    icon: [
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/favicon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/brand/apple-touch-icon.png', sizes: '180x180' }],
  },
  manifest: '/manifest.webmanifest',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom stays enabled: disabling it is an accessibility regression, and
  // the layout is built to tolerate it.
  maximumScale: 5,
  // Covers the notch so the glass bar can sit against the physical edge, with
  // safe-area insets handling the actual spacing.
  viewportFit: 'cover',
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG">
      <head>
        {/*
          Design tokens, inlined ahead of the stylesheet.

          These are generated from packages/shared/src/tokens.ts, which is the
          single source of truth shared with the API and the admin console. They
          are inlined rather than imported as CSS because Tailwind v4 prunes
          custom properties it does not see referenced, which dropped the glass
          blur and fill and left the signature navigation as an unblurred
          transparent box. Inlining also removes a render-blocking request.
        */}
        <style id="fx-tokens" dangerouslySetInnerHTML={{ __html: tokenStylesheet() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
