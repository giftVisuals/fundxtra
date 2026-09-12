'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import {
  formatNaira,
  relativeTime,
  tokens,
  type Announcement,
} from '@fundxtra/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, StatBlock } from '@/components/ui';
import { EarnIcon, GiftIcon, ReferIcon, WalletIcon } from '@/components/glass';
import { PanelHeader, Row, Section, IconTile } from './shared';

/**
 * Home.
 *
 * Answers, in order: how much have I got, is it moving, and what should I do
 * next. The balance is the largest thing on the screen because it is the reason
 * the user opened the app; everything else is a route to changing it.
 */
export function HomePanel({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { dashboard, user, refresh } = useSession();
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ announcements: Announcement[] }>('/announcements')
      .then((result) => {
        if (!cancelled) setAnnouncements(result.announcements);
      })
      .catch(() => {
        // Announcements are supplementary: a failure here renders no section
        // rather than an error, because it must not disturb the balance the
        // user actually came to see.
        if (!cancelled) setAnnouncements([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh on return to the app, so a reward credited elsewhere (an approved
  // screenshot, a referral qualifying) shows up without a manual pull.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  if (!dashboard || !user) return null;

  const firstName = user.firstName.split(' ')[0] ?? user.firstName;

  return (
    <div>
      <PanelHeader
        title={`Hello, ${firstName}`}
        subtitle="Complete tasks. Earn rewards. Refer friends."
      />

      {/* Balance. The one place in the Mini App that uses the glass treatment
          outside the navigation — it is the hero, and it sits on a plain white
          page where a glass card reads as depth rather than clutter. */}
      <Card
        tone="brand"
        padding={20}
        radius={tokens.radii.xl}
        style={{ marginBottom: 14, position: 'relative', overflow: 'hidden' }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -60,
            right: -40,
            width: 180,
            height: 180,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${tokens.colors.cocoa[200]} 0%, transparent 70%)`,
            opacity: 0.7,
          }}
        />
        <div style={{ position: 'relative' }}>
          <p
            style={{
              fontSize: tokens.typography.size.xs,
              fontWeight: tokens.typography.weight.medium,
              letterSpacing: tokens.typography.tracking.wider,
              textTransform: 'uppercase',
              color: tokens.colors.cocoa[700],
              opacity: 0.75,
            }}
          >
            Your balance
          </p>
          <AnimatedBalance kobo={user.balanceKobo} />

          {user.pendingOutKobo > 0 && (
            <p
              style={{
                marginTop: 6,
                fontSize: tokens.typography.size.xs,
                color: tokens.colors.cocoa[700],
                opacity: 0.8,
              }}
            >
              {formatNaira(user.pendingOutKobo)} being processed
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <Button
              size="md"
              style={{ flex: 1 }}
              onClick={() => onNavigate('earn')}
              leadingIcon={<EarnIcon active />}
            >
              Earn now
            </Button>
            <Button
              size="md"
              variant="secondary"
              style={{ flex: 1 }}
              onClick={() => onNavigate('wallet')}
              leadingIcon={<WalletIcon />}
            >
              Withdraw
            </Button>
          </div>
        </div>
      </Card>

      {/* Today's activity. Three figures, tabular so they do not jitter. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          marginBottom: 24,
        }}
      >
        <Card padding={14}>
          <StatBlock label="Today" value={formatNaira(dashboard.todayEarnedKobo)} />
        </Card>
        <Card padding={14}>
          <StatBlock label="Tasks" value={user.tasksCompleted.toLocaleString('en-NG')} />
        </Card>
        <Card padding={14}>
          <StatBlock label="Referrals" value={user.qualifiedReferralCount.toLocaleString('en-NG')} />
        </Card>
      </div>

      {/* Withdrawal availability, stated plainly rather than discovered on
          failure. A closed portal with a reason is far less frustrating than a
          button that rejects you. */}
      {!dashboard.withdrawalsOpen && dashboard.withdrawalNotice && (
        <Card tone="warning" padding={14} style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Badge tone="warning" mark="clock">
              Withdrawals closed
            </Badge>
          </div>
          <p
            style={{
              marginTop: 8,
              fontSize: tokens.typography.size.sm,
              lineHeight: tokens.typography.leading.relaxed,
              color: tokens.colors.warning.strong,
            }}
          >
            {dashboard.withdrawalNotice}
          </p>
        </Card>
      )}

      {dashboard.pendingSubmissionCount > 0 && (
        <Section title="Waiting on review">
          <Row
            leading={<IconTile tone="warning"><ClockGlyph /></IconTile>}
            title={`${dashboard.pendingSubmissionCount} ${
              dashboard.pendingSubmissionCount === 1 ? 'submission' : 'submissions'
            } under review`}
            subtitle="A reviewer checks screenshots, usually within 24 hours"
            onClick={() => onNavigate('earn')}
          />
        </Section>
      )}

      <Section title="What next">
        <Row
          leading={<IconTile><EarnIcon active /></IconTile>}
          title={
            dashboard.availableTaskCount > 0
              ? `${dashboard.availableTaskCount} ${dashboard.availableTaskCount === 1 ? 'task' : 'tasks'} available`
              : 'Check for new tasks'
          }
          subtitle="Complete sponsored tasks to earn Naira"
          onClick={() => onNavigate('earn')}
        />
        <Row
          leading={<IconTile><ReferIcon active /></IconTile>}
          title="Refer a friend"
          subtitle="Earn a bonus for every friend who joins and sets up"
          onClick={() => onNavigate('refer')}
        />
        <Row
          leading={<IconTile><GiftIcon active /></IconTile>}
          title="Rewards"
          subtitle="Cash, airtime, data, Telegram Stars and Premium"
          onClick={() => onNavigate('wallet')}
        />
      </Section>

      {announcements && announcements.length > 0 && (
        <Section title="Announcements">
          {announcements.map((announcement) => (
            <Card key={announcement.id} padding={14}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <h3
                  style={{
                    fontSize: tokens.typography.size.base,
                    fontWeight: tokens.typography.weight.semibold,
                  }}
                >
                  {announcement.title}
                </h3>
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: tokens.typography.size['2xs'],
                    color: tokens.semantic.inkFaint,
                  }}
                >
                  {relativeTime(announcement.createdAt)}
                </span>
              </div>
              <p
                style={{
                  marginTop: 6,
                  fontSize: tokens.typography.size.sm,
                  lineHeight: tokens.typography.leading.relaxed,
                  color: tokens.semantic.inkMuted,
                }}
              >
                {announcement.body}
              </p>
            </Card>
          ))}
        </Section>
      )}
    </div>
  );
}

/**
 * Balance display that counts up to a new value.
 *
 * Only animates when the balance actually *increases*, and only after the
 * first render — so earning a reward feels like something, while simply
 * opening the app does not perform a pointless countdown. The DOM text is
 * updated imperatively to avoid re-rendering the whole panel 60 times a second.
 */
function AnimatedBalance({ kobo }: { kobo: number }) {
  const reduceMotion = useReducedMotion();
  const nodeRef = useRef<HTMLSpanElement>(null);
  const previous = useRef(kobo);

  useEffect(() => {
    const node = nodeRef.current;
    const from = previous.current;
    previous.current = kobo;

    if (!node) return;
    if (reduceMotion || kobo <= from) {
      node.textContent = formatNaira(kobo);
      return;
    }

    const duration = 620;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      // Ease-out cubic: fast then settling, which reads as money landing.
      const eased = 1 - (1 - progress) ** 3;
      node.textContent = formatNaira(Math.round(from + (kobo - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [kobo, reduceMotion]);

  return (
    <motion.p
      className="fx-tabular"
      style={{
        marginTop: 6,
        fontFamily: tokens.typography.fontDisplay,
        fontSize: tokens.typography.size['5xl'],
        fontWeight: tokens.typography.weight.bold,
        letterSpacing: tokens.typography.tracking.tighter,
        lineHeight: 1,
        color: tokens.colors.cocoa[800],
      }}
    >
      <span ref={nodeRef}>{formatNaira(kobo)}</span>
    </motion.p>
  );
}

function ClockGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round">
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4V12l3.2 2.6" />
    </svg>
  );
}
