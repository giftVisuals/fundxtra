import type { Metadata } from 'next';
import { SessionProvider } from '@/lib/session';
import { AppShell } from '@/components/miniapp/AppShell';

/**
 * The Telegram Mini App.
 *
 * A single route rather than one per tab, which is what lets the glass
 * navigation keep its springs alive across a tab change — see AppShell.
 * Deep links use the hash (`/app#wallet`).
 */
export const metadata: Metadata = {
  title: 'Fundxtra',
  // Never indexed: it is an authenticated surface and the marketing site is
  // what should rank for the brand.
  robots: { index: false, follow: false },
};

export default function MiniAppPage() {
  return (
    <>
      {/*
        Telegram's Mini App SDK. Loaded from Telegram's own CDN because it must
        be the client's current version — bundling a copy would pin us to
        whatever shipped at build time and break on older clients.
      */}
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <script src="https://telegram.org/js/telegram-web-app.js" />
      <SessionProvider>
        <AppShell />
      </SessionProvider>
    </>
  );
}
