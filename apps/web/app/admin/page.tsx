import type { Metadata } from 'next';
import { AdminProvider } from '@/lib/admin-session';
import { AdminShell } from '@/components/admin/AdminShell';

/**
 * Admin console.
 *
 * Never indexed, and authorisation is resolved server-side on every request —
 * this page renders a refusal for a non-admin rather than hiding the route.
 */
export const metadata: Metadata = {
  title: 'Fundxtra admin',
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <script src="https://telegram.org/js/telegram-web-app.js" />
      <AdminProvider>
        <AdminShell />
      </AdminProvider>
    </>
  );
}
