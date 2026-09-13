'use client';

import { useCallback, useState } from 'react';
import {
  formatNaira,
  relativeTime,
  tokens,
  type ReferralStatus,
  type ReferralSummary,
} from '@fundxtra/shared';
import { useResource } from '@/lib/resource';
import { supportUrl } from '@/lib/config';
import { haptic, openExternal } from '@/lib/telegram';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  SkeletonList,
  StatBlock,
} from '@/components/ui';
import { ReferIcon } from '@/components/glass';
import { PanelHeader, Row, Section, IconTile } from './shared';

interface ReferralRow {
  id: string;
  firstName: string;
  username: string | null;
  status: ReferralStatus;
  rewardKobo: number;
  createdAt: string;
  qualifiedAt: string | null;
}

interface ReferralPayload {
  summary: ReferralSummary;
  referrals: ReferralRow[];
  qualification: string[];
  enabled: boolean;
}

/**
 * Refer.
 *
 * The qualification rule is the most important thing on this screen. A referral
 * programme where people cannot tell why a referral did or did not pay is where
 * trust goes to die, so the four steps are listed explicitly, sourced from the
 * server so the copy cannot drift from the rule the backend actually enforces.
 *
 * Pending referrals are shown as pending rather than hidden — a friend who has
 * joined but not finished setting up is real information the referrer can act
 * on by nudging them.
 */
export function ReferPanel() {
  const [copied, setCopied] = useState(false);

  // Cached: leaving and returning to this tab should not re-read the referral
  // list from Firestore every time.
  const { data, error, reload: load } = useResource<ReferralPayload>('/referrals');

  const copyLink = useCallback(async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      haptic.success();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused in a WebView; falling back to a share
      // sheet is better than telling the user nothing happened.
      openExternal(
        `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(
          'Join me on Fundxtra — complete tasks and earn Naira rewards.',
        )}`,
      );
    }
  }, []);

  if (error && !data) {
    return (
      <div>
        <PanelHeader title="Refer" />
        <ErrorState message={error} onRetry={() => void load()} supportUrl={supportUrl} />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <PanelHeader title="Refer" subtitle="Invite friends and earn together." />
        <SkeletonList count={2} lines={4} />
      </div>
    );
  }

  const { summary, referrals, qualification, enabled } = data;

  return (
    <div>
      <PanelHeader
        title="Refer"
        subtitle={`Earn ${formatNaira(summary.rewardPerReferralKobo)} for every friend who joins and sets up.`}
      />

      {!enabled && (
        <Card tone="warning" padding={14} style={{ marginBottom: 16 }}>
          <Badge tone="warning" mark="clock">Paused</Badge>
          <p
            style={{
              marginTop: 8,
              fontSize: tokens.typography.size.sm,
              color: tokens.colors.warning.strong,
              lineHeight: tokens.typography.leading.relaxed,
            }}
          >
            The referral programme is paused right now. Existing qualified referrals are
            unaffected.
          </p>
        </Card>
      )}

      {/* Earnings summary. */}
      <Card tone="brand" padding={20} radius={tokens.radii.xl} style={{ marginBottom: 14 }}>
        <StatBlock
          label="Referral earnings"
          value={formatNaira(summary.earningsKobo)}
          emphasis
          hint={`${summary.qualifiedReferrals} qualified · ${summary.pendingReferrals} pending`}
        />
      </Card>

      {/* The link. The primary action on this screen, so it gets the most
          prominent treatment after the earnings figure. */}
      <Section title="Your referral link">
        <Card padding={14}>
          <p
            style={{
              fontFamily: tokens.typography.fontMono,
              fontSize: tokens.typography.size.xs,
              wordBreak: 'break-all',
              color: tokens.semantic.inkMuted,
              lineHeight: tokens.typography.leading.relaxed,
            }}
          >
            {summary.referralLink}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Button
              style={{ flex: 1 }}
              onClick={() => void copyLink(summary.referralLink)}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button
              variant="secondary"
              style={{ flex: 1 }}
              onClick={() =>
                openExternal(
                  `https://t.me/share/url?url=${encodeURIComponent(
                    summary.referralLink,
                  )}&text=${encodeURIComponent(
                    'Join me on Fundxtra — complete tasks and earn Naira rewards.',
                  )}`,
                )
              }
            >
              Share
            </Button>
          </div>
          <p
            style={{
              marginTop: 12,
              fontSize: tokens.typography.size.xs,
              color: tokens.semantic.inkSubtle,
            }}
          >
            Your code: <strong style={{ color: tokens.semantic.brandInk }}>{summary.referralCode}</strong>
          </p>
        </Card>
      </Section>

      {/* How qualification works. Numbered, unambiguous, server-sourced. */}
      <Section title="How a referral qualifies">
        <Card padding={16}>
          <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
            {qualification.map((step, index) => (
              <li key={index} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span
                  aria-hidden="true"
                  style={{
                    flexShrink: 0,
                    display: 'grid',
                    placeItems: 'center',
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background:
                      index === qualification.length - 1
                        ? tokens.colors.success.soft
                        : tokens.colors.cocoa[50],
                    border: `1px solid ${
                      index === qualification.length - 1 ? '#cfe7d7' : tokens.colors.cocoa[200]
                    }`,
                    color:
                      index === qualification.length - 1
                        ? tokens.colors.success.strong
                        : tokens.colors.cocoa[700],
                    fontSize: tokens.typography.size['2xs'],
                    fontWeight: tokens.typography.weight.bold,
                  }}
                >
                  {index === qualification.length - 1 ? '₦' : index + 1}
                </span>
                <span
                  style={{
                    fontSize: tokens.typography.size.base,
                    lineHeight: tokens.typography.leading.snug,
                    fontWeight:
                      index === qualification.length - 1
                        ? tokens.typography.weight.semibold
                        : tokens.typography.weight.regular,
                  }}
                >
                  {step}
                </span>
              </li>
            ))}
          </ol>
          <p
            style={{
              marginTop: 14,
              paddingTop: 14,
              borderTop: `1px solid ${tokens.semantic.divider}`,
              fontSize: tokens.typography.size.xs,
              lineHeight: tokens.typography.leading.relaxed,
              color: tokens.semantic.inkMuted,
            }}
          >
            Your friend does not need to complete a task for you to get paid. One reward per
            Telegram account, and self-referrals do not count.
          </p>
        </Card>
      </Section>

      <Section title={`Your referrals (${summary.totalReferrals})`}>
        {referrals.length === 0 ? (
          <EmptyState
            icon={<ReferIcon active />}
            title="No referrals yet"
            description={`Share your link with one friend. When they join and set up their PIN, ${formatNaira(
              summary.rewardPerReferralKobo,
            )} lands in your balance.`}
            action={{ label: 'Copy your link', onClick: () => void copyLink(summary.referralLink) }}
          />
        ) : (
          referrals.map((referral) => (
            <Row
              key={referral.id}
              leading={
                <IconTile tone={referral.status === 'QUALIFIED' ? 'success' : 'neutral'}>
                  <ReferIcon active={referral.status === 'QUALIFIED'} />
                </IconTile>
              }
              title={referral.firstName}
              subtitle={
                referral.status === 'QUALIFIED'
                  ? `Qualified ${relativeTime(referral.qualifiedAt)}`
                  : referral.status === 'PENDING'
                    ? `Joined ${relativeTime(referral.createdAt)} · still setting up`
                    : 'Not eligible'
              }
              trailing={
                referral.status === 'QUALIFIED' ? (
                  <span
                    className="fx-tabular"
                    style={{
                      fontSize: tokens.typography.size.base,
                      fontWeight: tokens.typography.weight.semibold,
                      color: tokens.colors.success.strong,
                    }}
                  >
                    {formatNaira(referral.rewardKobo, { signed: true })}
                  </span>
                ) : referral.status === 'PENDING' ? (
                  <Badge tone="warning" mark="clock">Pending</Badge>
                ) : (
                  <Badge tone="neutral" mark="cross">Rejected</Badge>
                )
              }
            />
          ))
        )}
      </Section>
    </div>
  );
}
