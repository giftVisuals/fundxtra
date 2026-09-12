'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { tokens } from '@fundxtra/shared';
import {
  EarnIcon,
  FluidGlassTabBar,
  GlassFilters,
  HomeIcon,
  ProfileIcon,
  ReferIcon,
  SwipeablePanels,
  WalletIcon,
  type GlassTab,
} from '@/components/glass';
import { BootLoader, Button, ErrorState } from '@/components/ui';
import { useSession } from '@/lib/session';
import { startEarningUrl, supportUrl } from '@/lib/config';
import { openExternal, useTelegramViewport } from '@/lib/telegram';
import { PinGate } from './PinGate';
import { HomePanel } from './panels/HomePanel';
import { EarnPanel } from './panels/EarnPanel';
import { ReferPanel } from './panels/ReferPanel';
import { WalletPanel } from './panels/WalletPanel';
import { ProfilePanel } from './panels/ProfilePanel';
import { AdminPreviewBanner } from './AdminPreviewBanner';

/**
 * Mini App shell.
 *
 * Renders the session state machine and, once ready, the five-panel tab
 * interface. Panels are switched client-side rather than routed, which is what
 * makes the glass navigation possible: a route change would unmount the tab bar
 * and restart its springs, and the continuity of that one moving lens is the
 * whole effect.
 *
 * The active tab is mirrored into the URL hash so a deep link (`/app#wallet`)
 * and the browser back button both work, without paying the cost of a real
 * route transition.
 */

const TAB_IDS = ['home', 'earn', 'refer', 'wallet', 'profile'] as const;
type TabId = (typeof TAB_IDS)[number];

function isTabId(value: string): value is TabId {
  return (TAB_IDS as readonly string[]).includes(value);
}

export function AppShell() {
  const session = useSession();
  const [activeTab, setActiveTab] = useState<TabId>('home');
  useTelegramViewport();

  // Restore the tab from the hash on mount, and keep them in sync afterwards.
  useEffect(() => {
    const fromHash = window.location.hash.replace('#', '');
    if (isTabId(fromHash)) setActiveTab(fromHash);

    const onHashChange = () => {
      const next = window.location.hash.replace('#', '');
      if (isTabId(next)) setActiveTab(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const changeTab = useCallback((id: string) => {
    if (!isTabId(id)) return;
    setActiveTab(id);
    // replaceState, not pushState: five tabs would otherwise fill the history
    // stack and make the back gesture feel broken.
    window.history.replaceState(null, '', `#${id}`);
  }, []);

  if (session.state === 'BOOTING') return <BootLoader />;

  if (session.state === 'OUTSIDE_TELEGRAM') return <OpenInTelegram />;

  if (session.state === 'ERROR') {
    return (
      <CentredMessage>
        <ErrorState
          title="We could not open Fundxtra"
          message={session.error?.message ?? 'Please try again.'}
          requestId={session.error?.requestId}
          onRetry={() => void session.reauthenticate()}
          supportUrl={supportUrl}
        />
      </CentredMessage>
    );
  }

  if (session.state === 'BLOCKED') return <AccountBlocked />;

  if (session.state === 'NEEDS_PIN' || session.state === 'LOCKED') {
    return (
      <PinGate
        mode={session.state === 'NEEDS_PIN' ? 'create' : 'unlock'}
        firstName={session.user?.firstName ?? 'friend'}
        locked={session.pinLocked}
        lockedUntil={session.lockedUntil}
        onAuthenticated={(token) => void session.completePinFlow(token)}
      />
    );
  }

  const dashboard = session.dashboard;
  if (!dashboard) return <BootLoader message="Loading your dashboard" />;

  const tabs: GlassTab[] = [
    { id: 'home', label: 'Home', Icon: HomeIcon },
    { id: 'earn', label: 'Earn', Icon: EarnIcon },
    { id: 'refer', label: 'Refer', Icon: ReferIcon },
    {
      id: 'wallet',
      label: 'Wallet',
      Icon: WalletIcon,
      // The badge surfaces work waiting on the user, not a vanity count.
      badge: dashboard.pendingSubmissionCount || undefined,
    },
    { id: 'profile', label: 'Profile', Icon: ProfileIcon },
  ];

  return (
    <div
      style={{
        minHeight: '100dvh',
        // Telegram's reported height when available, dvh otherwise.
        minBlockSize: 'var(--fx-viewport-height, 100dvh)',
        background: tokens.semantic.bg,
      }}
    >
      {/* The refraction filters. Rendered once, referenced by the glass bar. */}
      <GlassFilters />

      {session.isAdmin && <AdminPreviewBanner role={session.adminRole} />}

      <main
        className="fx-tabbar-clearance"
        style={{
          maxWidth: tokens.layout.appMaxWidth,
          margin: '0 auto',
          padding: '0 16px',
        }}
      >
        <SwipeablePanels ids={[...TAB_IDS]} activeId={activeTab} onChange={changeTab}>
          {activeTab === 'home' && <HomePanel onNavigate={changeTab} />}
          {activeTab === 'earn' && <EarnPanel />}
          {activeTab === 'refer' && <ReferPanel />}
          {activeTab === 'wallet' && <WalletPanel />}
          {activeTab === 'profile' && <ProfilePanel />}
        </SwipeablePanels>
      </main>

      <FluidGlassTabBar tabs={tabs} activeId={activeTab} onChange={changeTab} />
    </div>
  );
}

function CentredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: tokens.semantic.bg,
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>{children}</div>
    </div>
  );
}

/**
 * Shown when the app is opened outside Telegram.
 *
 * This is a real state, not an error: the URL is shareable, so people will land
 * here from a link. It explains what Fundxtra is and hands them the bot, rather
 * than showing an authentication failure they cannot act on.
 */
function OpenInTelegram() {
  return (
    <CentredMessage>
      <div style={{ textAlign: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/fundxtra-mark.png"
          alt="Fundxtra"
          width={56}
          height={46}
          style={{ margin: '0 auto 24px' }}
        />
        <h1 style={{ fontSize: tokens.typography.size['2xl'] }}>Open Fundxtra in Telegram</h1>
        <p
          style={{
            marginTop: 10,
            fontSize: tokens.typography.size.base,
            lineHeight: tokens.typography.leading.relaxed,
            color: tokens.semantic.inkMuted,
          }}
        >
          Fundxtra runs inside Telegram, which is how we keep your account secure without asking
          for an email or a password. Start the bot to complete tasks and earn rewards.
        </p>
        <div style={{ display: 'grid', gap: 10, marginTop: 28 }}>
          <Button size="lg" fullWidth onClick={() => openExternal(startEarningUrl)}>
            Start earning on Telegram
          </Button>
          <Link
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 38,
              fontSize: tokens.typography.size.sm,
              fontWeight: tokens.typography.weight.medium,
              color: tokens.semantic.inkMuted,
            }}
          >
            Learn about Fundxtra
          </Link>
        </div>
      </div>
    </CentredMessage>
  );
}

function AccountBlocked() {
  const session = useSession();
  const banned = session.user?.status === 'BANNED';

  return (
    <CentredMessage>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: tokens.typography.size.xl }}>
          {banned ? 'This account is closed' : 'Your account is on hold'}
        </h1>
        <p
          style={{
            marginTop: 10,
            fontSize: tokens.typography.size.base,
            lineHeight: tokens.typography.leading.relaxed,
            color: tokens.semantic.inkMuted,
          }}
        >
          {banned
            ? 'Please contact Fundxtra Support if you believe this is a mistake.'
            : 'Our team is reviewing your account. Your balance is safe. Contact support for an update.'}
        </p>
        <Button
          variant="secondary"
          style={{ marginTop: 24 }}
          onClick={() => openExternal(supportUrl)}
        >
          Contact Fundxtra Support
        </Button>
      </div>
    </CentredMessage>
  );
}
